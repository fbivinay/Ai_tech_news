// In-memory news store.
//
// Fetches RSS/Atom feeds on an interval, normalizes each entry into a
// compliant "news card" record (headline, excerpt-derived summary, source
// attribution, tags — never a full article body), classifies and scores it,
// and exposes a sorted, deduplicated list plus a hero pick.

const crypto = require('crypto');
const Parser = require('rss-parser');
const SOURCES = require('./config/sources');
const { stripHtml, truncateWords } = require('./lib/text');
const { classify } = require('./lib/classify');
const { scoreItem } = require('./lib/score');
const { summarizeAll, aiEnabled } = require('./lib/summarize');

const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS || 60 * 1000);
const FETCH_TIMEOUT_MS = 7000;
const MAX_ITEMS_PER_SOURCE = 20;
const MAX_AGE_DAYS = 7;
const HERO_MAX_AGE_HOURS = 36;

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['content:encoded', 'contentEncoded'],
    ],
  },
});

const state = {
  items: [],
  byId: new Map(),
  lastRefresh: null,
  refreshing: false,
  sourceStatus: {},
};

function hashId(link) {
  return crypto.createHash('sha1').update(link).digest('hex').slice(0, 16);
}

function normalizeLink(link) {
  try {
    const url = new URL(link);
    if (!/^https?:$/i.test(url.protocol)) return null;
    url.hash = '';
    for (const param of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$)/i.test(param)) url.searchParams.delete(param);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function extractImage(entry) {
  const fromMedia = (list) => {
    if (!Array.isArray(list)) return null;
    for (const media of list) {
      const url = media?.$?.url;
      if (url && /^https?:/i.test(url)) return url;
    }
    return null;
  };

  const enclosureUrl =
    entry.enclosure?.url && /image|jpe?g|png|webp|gif/i.test(`${entry.enclosure.type} ${entry.enclosure.url}`)
      ? entry.enclosure.url
      : null;

  const html = entry.contentEncoded || entry.content || '';
  const imgMatch = typeof html === 'string' ? html.match(/<img[^>]+src=["']([^"']+)["']/i) : null;

  return (
    fromMedia(entry.mediaContent) ||
    fromMedia(entry.mediaThumbnail) ||
    enclosureUrl ||
    (imgMatch && /^https?:/i.test(imgMatch[1]) ? imgMatch[1] : null)
  );
}

// Several publishers 403 non-browser user agents on their public endpoints.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchFeed(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        'user-agent': BROWSER_UA,
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    // Escape stray ampersands that aren't part of an entity — some feeds ship
    // malformed XML that the strict parser would otherwise reject outright.
    const sanitized = xml.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
    return await parser.parseString(sanitized);
  } finally {
    clearTimeout(timer);
  }
}

// Some feeds (TechCrunch, CNBC, Bleeping Computer…) ship no image tags at
// all — ~20% of homepage cards used to be gray placeholders. For those,
// pull the og:image / twitter:image meta tag from the article page.
// Compliance note: only the <meta> thumbnail URL is extracted; the page
// body is never stored or displayed.
const OG_LOOKUPS_PER_REFRESH = 20;
const OG_TIMEOUT_MS = 3500;

async function fetchOgImage(link) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OG_TIMEOUT_MS);
  try {
    const res = await fetch(link, {
      signal: controller.signal,
      headers: { 'user-agent': BROWSER_UA, accept: 'text/html' },
    });
    if (!res.ok) return null;
    const head = (await res.text()).slice(0, 200000);
    const m =
      head.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/i) ||
      head.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image(?::url)?|twitter:image)["']/i);
    if (!m) return null;
    const url = new URL(m[1].replace(/&amp;/g, '&'), link).toString();
    return /^https?:/i.test(url) ? url : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeEntry(entry, source) {
  const link = normalizeLink(entry.link || entry.guid || '');
  if (!link || !entry.title) return null;

  const publishedAt = entry.isoDate || entry.pubDate;
  const published = publishedAt ? new Date(publishedAt) : new Date();
  if (Number.isNaN(published.getTime())) return null;
  if (Date.now() - published.getTime() > MAX_AGE_DAYS * 864e5) return null;

  const title = stripHtml(entry.title);
  // Short excerpt only — used as summarization input, never displayed as body text.
  const excerpt = truncateWords(stripHtml(entry.contentSnippet || entry.summary || entry.content || ''), 150);
  const { category, companies, region } = classify(title, excerpt);

  let sourceDomain;
  try {
    sourceDomain = new URL(source.homepage).hostname;
  } catch {
    sourceDomain = '';
  }

  return {
    id: hashId(link),
    title,
    link,
    sourceName: source.name,
    sourceHomepage: source.homepage,
    sourceDomain,
    publishedAt: published.toISOString(),
    excerpt,
    image: extractImage(entry),
    category,
    companies,
    region,
    summary: null,
    summarySource: null,
  };
}

function dedupeTitleKey(title) {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).slice(0, 10).join(' ');
}

let refreshPromise = null;

function refresh(options = {}) {
  // Callers awaiting a refresh that's already in flight share its promise
  // instead of silently getting nothing.
  if (state.refreshing) return refreshPromise;
  state.refreshing = true;
  refreshPromise = doRefresh(options).finally(() => {
    state.refreshing = false;
    refreshPromise = null;
  });
  return refreshPromise;
}

async function doRefresh({ maxSummaryBatches = Infinity } = {}) {
  const results = await Promise.allSettled(SOURCES.map((source) => fetchFeed(source)));

  const incoming = [];
  results.forEach((result, i) => {
    const source = SOURCES[i];
    if (result.status === 'fulfilled') {
      const entries = (result.value.items || []).slice(0, MAX_ITEMS_PER_SOURCE);
      let added = 0;
      for (const entry of entries) {
        const item = normalizeEntry(entry, source);
        if (item) {
          incoming.push(item);
          added++;
        }
      }
      state.sourceStatus[source.name] = { ok: true, items: added, at: new Date().toISOString() };
    } else {
      state.sourceStatus[source.name] = { ok: false, error: result.reason?.message, at: new Date().toISOString() };
      console.warn(`[refresh] ${source.name}: ${result.reason?.message}`);
    }
  });

  // Merge, keeping already-summarized versions of known items.
  const titleKeys = new Set();
  const merged = new Map();
  for (const item of incoming) {
    const existing = state.byId.get(item.id);
    // Carry over what past refreshes already earned for this story: the AI
    // summary and any og:image looked up from the article page (the feed
    // entry itself still has image: null for those).
    const record = existing && existing.summarySource === 'ai' ? existing : {
      ...item,
      image: item.image || existing?.image || null,
      imageChecked: existing?.imageChecked || false,
      summary: existing?.summary || null,
      summarySource: existing?.summarySource || null,
    };
    const titleKey = dedupeTitleKey(record.title);
    if (merged.has(record.id) || titleKeys.has(titleKey)) continue;
    titleKeys.add(titleKey);
    merged.set(record.id, record);
  }

  // Re-add stories we already know about but that this fetch round didn't
  // return (a source timed out, got rate-limited, or the item scrolled off
  // its feed). Without this, a transient source failure makes its stories —
  // and sometimes an entire section — vanish until the next good fetch.
  for (const item of state.items) {
    if (merged.has(item.id)) continue;
    if (Date.now() - new Date(item.publishedAt).getTime() > MAX_AGE_DAYS * 864e5) continue;
    const titleKey = dedupeTitleKey(item.title);
    if (titleKeys.has(titleKey)) continue;
    titleKeys.add(titleKey);
    merged.set(item.id, item);
  }

  const items = [...merged.values()];

  // Fill in missing card images from article og:image tags — newest first,
  // capped per refresh, each marked so a story is only ever looked up once.
  const missingImage = items
    .filter((item) => !item.image && !item.imageChecked)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, OG_LOOKUPS_PER_REFRESH);
  await Promise.allSettled(missingImage.map(async (item) => {
    item.image = await fetchOgImage(item.link);
    item.imageChecked = true;
  }));

  await summarizeAll(items, { maxBatches: maxSummaryBatches });

  const sourceWeights = Object.fromEntries(SOURCES.map((s) => [s.name, s.weight]));
  for (const item of items) {
    item.score = scoreItem(item, sourceWeights[item.sourceName]);
  }

  items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  items.length = Math.min(items.length, 800); // bound memory / payloads

  state.items = items;
  state.byId = new Map(items.map((item) => [item.id, item]));
  state.lastRefresh = new Date().toISOString();
  console.log(`[refresh] ${items.length} items from ${SOURCES.length} sources (AI summaries: ${aiEnabled() ? 'on' : 'off — extractive fallback'})`);
}

// First-load freshness guarantee: if the data in hand is older than maxAgeMs,
// block on one summary-free refresh so the visitor's first paint is today's
// news, not the seed's. Bounded by budgetMs in case we end up awaiting an
// in-flight refresh that includes a slow Claude batch — past the budget we
// serve what we have rather than keep the visitor staring at skeletons.
async function ensureFresh(maxAgeMs = 5 * 60 * 1000, budgetMs = 12000) {
  if (state.lastRefresh && Date.now() - new Date(state.lastRefresh).getTime() <= maxAgeMs) return;
  const done = refresh({ maxSummaryBatches: 0 }).catch((err) => {
    console.error('[refresh] blocking fresh refresh failed:', err.message);
  });
  await Promise.race([
    done,
    new Promise((resolve) => setTimeout(resolve, budgetMs).unref?.()),
  ]);
}

function pickHero() {
  const cutoff = Date.now() - HERO_MAX_AGE_HOURS * 36e5;
  const candidates = state.items.filter((item) => new Date(item.publishedAt).getTime() >= cutoff);
  if (candidates.length === 0) return state.items[0] || null;

  const withImage = candidates.filter((item) => item.image);
  const pool = withImage.length > 0 ? withImage : candidates;
  return pool.reduce((best, item) => (item.score > best.score ? item : best), pool[0]);
}

function getFeed({ page = 1, limit = 12, category = null } = {}) {
  const hero = pickHero();
  let items = state.items.filter((item) => item !== hero);
  if (category && category !== 'All') {
    items = items.filter((item) => item.category === category);
  }

  const start = (page - 1) * limit;
  const slice = items.slice(start, start + limit);

  return {
    hero: page === 1 && (!category || category === 'All') ? hero : null,
    items: slice,
    page,
    hasMore: start + limit < items.length,
    total: items.length,
    lastRefresh: state.lastRefresh,
  };
}

// Canonical section order. Rails and category chips always follow this,
// so sections never reshuffle or vanish between refreshes.
const SECTION_ORDER = [
  'AI Models', 'Tech', 'Startups & Funding', 'Policy & Regulation', 'Security',
  'Hardware & Chips', 'Consumer Tech', 'Research', 'Robotics', 'Cloud & Enterprise', 'Open Source',
];

// Netflix-style homepage payload: billboard hero, a "Trending Now" rail of
// the highest-scoring recent stories, and one rail per major category.
function getRows() {
  const hero = pickHero();
  const rest = state.items.filter((item) => item !== hero);

  const cutoff = Date.now() - 48 * 36e5;
  const trending = rest
    .filter((item) => new Date(item.publishedAt).getTime() >= cutoff)
    .sort((a, b) => b.score - a.score)
    .slice(0, 14);
  const trendingIds = new Set(trending.map((item) => item.id));

  const byCategory = new Map();
  for (const item of rest) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push(item);
  }

  const rows = SECTION_ORDER
    .map((name) => ({
      name,
      items: (byCategory.get(name) || []).filter((item) => !trendingIds.has(item.id)).slice(0, 14),
    }))
    .filter((row) => row.items.length >= 3)
    .slice(0, 8);

  return { hero, trending, rows, lastRefresh: state.lastRefresh };
}

// Fixed taxonomy with live counts — every category always appears, in the
// same order, even when it currently has few or no stories.
function getCategories() {
  const counts = new Map();
  for (const item of state.items) {
    counts.set(item.category, (counts.get(item.category) || 0) + 1);
  }
  return SECTION_ORDER.map((name) => ({ name, count: counts.get(name) || 0 }));
}

// Full-store snapshot: lets a cold serverless instance hydrate from the
// CDN-cached copy of another instance instead of re-fetching 36 feeds.
function getSnapshot() {
  return { lastRefresh: state.lastRefresh, items: state.items };
}

// Public health payload for /api/status — per-source failure *messages* are
// deliberately dropped (they're internal fetch/network detail, not something
// an unauthenticated caller needs); `ok` is what an uptime monitor should key
// its alert on.
function getHealth() {
  const sources = {};
  for (const [name, s] of Object.entries(state.sourceStatus)) {
    sources[name] = { ok: s.ok, items: s.items || 0, at: s.at };
  }
  const sourcesOk = Object.values(sources).filter((s) => s.ok).length;
  return {
    ok: state.items.length > 0,
    items: state.items.length,
    lastRefresh: state.lastRefresh,
    sourcesOk,
    sourcesTotal: Object.keys(sources).length,
    sources,
  };
}

function loadSnapshot(snapshot) {
  if (!snapshot?.items?.length) return false;
  state.items = snapshot.items;
  state.byId = new Map(snapshot.items.map((item) => [item.id, item]));
  state.lastRefresh = snapshot.lastRefresh || new Date().toISOString();
  console.log(`[hydrate] loaded ${snapshot.items.length} items from snapshot`);
  return true;
}

async function hydrateFromSnapshot() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (!host) return false;
  try {
    const res = await fetch(`https://${host}/api/snapshot`, {
      signal: AbortSignal.timeout(2000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return false;
    return loadSnapshot(await res.json());
  } catch {
    return false;
  }
}

// Last-resort bootstrap: a news snapshot bundled with the deployment itself.
// Slightly old, but it makes even the very first request after a deploy
// instant — the background refresh replaces it within seconds.
function loadSeed() {
  try {
    return loadSnapshot(require('../data/seed.json'));
  } catch {
    return false;
  }
}

// Long-running server mode: background interval keeps the store warm.
// The bundled seed makes the very first requests instant while the real
// fetch completes.
function start() {
  if (state.items.length === 0) loadSeed();
  refresh().catch((err) => console.error('[refresh] initial refresh failed:', err));
  setInterval(() => refresh().catch((err) => console.error('[refresh] failed:', err)), REFRESH_INTERVAL_MS);
}

// Serverless mode (Vercel): only a cold start (empty store) blocks the
// request. When data merely went stale, we serve it immediately and return
// the refresh promise so the handler can hand it to waitUntil() — the user
// never waits on feed fetching. Paired with CDN s-maxage caching, most
// requests never even reach a function.
// The hard rule of the request path: NEVER block a response on feed
// fetching. Data is found in this order — memory → CDN snapshot (~100ms)
// → seed bundled with the deployment (instant) — and any actual feed
// refresh runs strictly in the background (waitUntil on Vercel).
// `ready: false` only happens if every bootstrap source is missing.
async function ensureReady() {
  const staleNow = () => !state.lastRefresh || Date.now() - new Date(state.lastRefresh).getTime() > REFRESH_INTERVAL_MS;

  if (state.items.length === 0) await hydrateFromSnapshot();
  if (state.items.length === 0) loadSeed();

  if (state.items.length > 0) {
    const background = staleNow() && !state.refreshing
      ? refresh({ maxSummaryBatches: 1 }).catch((err) => console.error('[refresh] background refresh failed:', err.message))
      : null;
    return { ready: true, background };
  }

  const background = state.refreshing
    ? null
    : refresh({ maxSummaryBatches: 0 }).catch((err) => console.error('[refresh] warmup failed:', err.message));
  return { ready: false, background };
}

module.exports = { start, ensureReady, ensureFresh, refresh, getFeed, getRows, getCategories, getSnapshot, getHealth, loadSeed, state };
