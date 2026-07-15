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

const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS || 10 * 60 * 1000);
const FETCH_TIMEOUT_MS = 15000;
const MAX_ITEMS_PER_SOURCE = 25;
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
    url.hash = '';
    for (const param of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$)/i.test(param)) url.searchParams.delete(param);
    }
    return url.toString();
  } catch {
    return link;
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

async function fetchFeed(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        // Several publishers 403 non-browser user agents on their public feeds.
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
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

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
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
      const record = existing && existing.summarySource === 'ai' ? existing : { ...item, summary: existing?.summary || null, summarySource: existing?.summarySource || null };
      const titleKey = dedupeTitleKey(record.title);
      if (merged.has(record.id) || titleKeys.has(titleKey)) continue;
      titleKeys.add(titleKey);
      merged.set(record.id, record);
    }

    const items = [...merged.values()];
    await summarizeAll(items);

    const sourceWeights = Object.fromEntries(SOURCES.map((s) => [s.name, s.weight]));
    for (const item of items) {
      item.score = scoreItem(item, sourceWeights[item.sourceName]);
    }

    items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    state.items = items;
    state.byId = new Map(items.map((item) => [item.id, item]));
    state.lastRefresh = new Date().toISOString();
    console.log(`[refresh] ${items.length} items from ${SOURCES.length} sources (AI summaries: ${aiEnabled() ? 'on' : 'off — extractive fallback'})`);
  } finally {
    state.refreshing = false;
  }
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

function getCategories() {
  const counts = new Map();
  for (const item of state.items) {
    counts.set(item.category, (counts.get(item.category) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function start() {
  refresh().catch((err) => console.error('[refresh] initial refresh failed:', err));
  setInterval(() => refresh().catch((err) => console.error('[refresh] failed:', err)), REFRESH_INTERVAL_MS);
}

module.exports = { start, refresh, getFeed, getCategories, state };
