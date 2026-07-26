// In-memory Explore resources store. Parallel to src/store.js but stripped
// down: no scoring, no Claude summaries, no classification. Fetches live
// feeds + a public Google Sheet every refresh, merges (never replaces, so a
// timed-out source doesn't erase its cards), drops stale items, and serves
// paginated cards per kind.

const { FEED_SOURCES, SHEET_TABS, KINDS, TAB_TO_KIND } = require('./config/resource-sources');
const { fetchFeed } = require('./lib/feed');
const {
  normalizeArxiv, normalizeRemoteOK, normalizeWWR, normalizeSheetRow,
  normalizeArbeitnow, normalizeJobicy, normalizeHimalayas, normalizeMuse,
  normalizeRemotive, isIndiaEligibleJob, TECH_TITLE_RE, classifyJobField,
  normalizeGreenhouse, normalizeLever, normalizeAshby, expFromText, salFromText,
  normalizeMsLearn, normalizeCoursera, classifyTopic,
  normalizeUnstopHackathon,
} = require('./lib/resource-normalize');
const { stripHtml } = require('./lib/text');

const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS || 60 * 1000);
const JSON_TIMEOUT_MS = 7000;
const MAX_PER_KIND = 120;

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const state = {
  byKind: Object.fromEntries(KINDS.map((k) => [k, []])),
  lastRefresh: null,
  refreshing: false,
  sourceStatus: {},
};

function emptyByKind() {
  return Object.fromEntries(KINDS.map((k) => [k, []]));
}

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    headers: { 'user-agent': BROWSER_UA, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Google Sheet published via the gviz endpoint. Response is wrapped in
// `google.visualization.Query.setResponse(<json>);` — slice out the JSON.
async function fetchSheet(tab) {
  const id = process.env.EXPLORE_SHEET_ID;
  if (!id) return [];
  const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(JSON_TIMEOUT_MS), headers: { 'user-agent': BROWSER_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const cols = (json.table.cols || []).map((c) => String(c.label || '').toLowerCase().trim());
  return (json.table.rows || []).map((r) => {
    const obj = {};
    cols.forEach((label, i) => { if (label) obj[label] = r.c[i] ? (r.c[i].v ?? '') : ''; });
    return obj;
  });
}

function normalizeFeedItem(src, raw) {
  if (src.id.startsWith('themuse')) return normalizeMuse(raw);
  if (src.id.startsWith('coursera')) return normalizeCoursera(raw);
  if (src.id === 'mslearn') return normalizeMsLearn(raw);
  switch (src.id) {
    case 'remoteok': return normalizeRemoteOK(raw);
    case 'wwr': return normalizeWWR(raw);
    case 'arbeitnow': return normalizeArbeitnow(raw);
    case 'jobicy': return normalizeJobicy(raw);
    case 'himalayas': return normalizeHimalayas(raw);
    case 'remotive': return normalizeRemotive(raw);
    case 'unstop-hackathons': return normalizeUnstopHackathon(raw);
    default: return src.kind === 'paper' ? normalizeArxiv(raw) : null;
  }
}

// Company career boards on public ATS APIs — every department is listed,
// so non-tech roles are dropped by title here.
const ATS_URLS = {
  greenhouse: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
  lever: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  ashby: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
};
const ATS_NORMALIZERS = { greenhouse: normalizeGreenhouse, lever: normalizeLever, ashby: normalizeAshby };

async function fetchATS(src) {
  const data = await fetchJson(ATS_URLS[src.ats](src.slug));
  let arr = src.ats === 'lever' ? data : (data && data.jobs);
  if (!Array.isArray(arr)) arr = [];
  return arr
    .map((raw) => ATS_NORMALIZERS[src.ats](raw, src))
    .filter((r) => r && TECH_TITLE_RE.test(r.title));
}

async function fetchFeedSource(src) {
  if (src.type === 'ats') return fetchATS(src);
  if (src.type === 'rss') {
    const feed = await fetchFeed(src.url);
    return (feed.items || []).map((raw) => normalizeFeedItem(src, raw));
  }
  // json
  const data = await fetchJson(src.url);
  let arr = src.arrayPath
    ? src.arrayPath.split('.').reduce((o, k) => (o == null ? o : o[k]), data)
    : data;
  if (!Array.isArray(arr)) arr = [];
  // RemoteOK's first array element is a legal notice, not a job.
  if (src.id === 'remoteok') arr = arr.filter((x) => x && x.position);
  let records = arr.map((raw) => normalizeFeedItem(src, raw));
  // Per-source cap (most popular first) so one huge catalog can't crowd
  // every other provider out of the kind's overall cap.
  if (src.max) {
    records = records.filter(Boolean)
      .sort((a, b) => ((b.meta && b.meta.popularity) || 0) - ((a.meta && a.meta.popularity) || 0))
      .slice(0, src.max);
  }
  return records;
}

function sortKind(kind, items) {
  if (kind === 'job' || kind === 'paper') {
    return items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }
  if (kind === 'course') {
    // Most popular first (MS Learn ships a real popularity score),
    // newest-seen breaks ties.
    return items.sort((a, b) =>
      ((b.meta && b.meta.popularity) || 0) - ((a.meta && a.meta.popularity) || 0)
      || new Date((b.meta && b.meta.firstSeen) || 0) - new Date((a.meta && a.meta.firstSeen) || 0));
  }
  return items; // hackathon: keep source order
}

// Pure: merge this round's `incoming` records with `previous` (merge-not-
// replace, so a source that failed keeps its prior cards), sort, and cap.
// No state access — unit-testable without network.
function mergeKind(kind, incoming, previous) {
  const merged = incoming.slice();
  const seen = new Set(merged.map((r) => r.id));
  for (const prev of previous) {
    if (!seen.has(prev.id)) { merged.push(prev); seen.add(prev.id); }
  }
  // Incoming wins the dedupe, but keep what past enrichment passes already
  // earned for a job (salary/experience fetched from its detail page).
  if (kind === 'job') {
    const prevById = new Map(previous.map((r) => [r.id, r]));
    for (const r of merged) {
      const prev = prevById.get(r.id);
      if (prev && prev !== r && prev.meta && prev.meta.enriched) {
        if (!r.meta.salary) r.meta.salary = prev.meta.salary || '';
        if (!r.meta.experience) r.meta.experience = prev.meta.experience || '';
        r.meta.enriched = true;
      }
    }
  }
  let result = merged;
  // Jobs are India-focused — also scrubs pre-filter records carried in from
  // an old snapshot. Higher cap: company boards supply several hundred.
  if (kind === 'job') {
    result = result.filter(isIndiaEligibleJob);
    // Field tag for the chips filter; also backfills snapshot-hydrated records.
    for (const r of result) { if (!r.meta.field) r.meta.field = classifyJobField(r.title); }
  }
  // Topic tag + first-seen stamp for courses/hackathons.
  if (kind === 'course' || kind === 'hackathon') {
    for (const r of result) {
      if (!r.meta.category) r.meta.category = classifyTopic(r.title) || 'Tech';
      if (!r.meta.firstSeen) r.meta.firstSeen = new Date().toISOString();
    }
  }
  const cap = kind === 'job' ? 300 : kind === 'course' ? 250 : MAX_PER_KIND;
  return sortKind(kind, result).slice(0, cap);
}

let refreshPromise = null;

function refresh() {
  if (state.refreshing) return refreshPromise;
  state.refreshing = true;
  refreshPromise = doRefresh().finally(() => { state.refreshing = false; refreshPromise = null; });
  return refreshPromise;
}

async function doRefresh() {
  const next = emptyByKind();

  // TTL sources (heavy catalogs) are only refetched once their window
  // lapses; merge-not-replace keeps their cards in between.
  const due = FEED_SOURCES.filter((src) => {
    if (!src.ttlMs) return true;
    const s = state.sourceStatus[src.id];
    return !(s && s.ok && Date.now() - new Date(s.at).getTime() < src.ttlMs);
  });

  const feedResults = await Promise.allSettled(due.map((src) => fetchFeedSource(src)));
  feedResults.forEach((result, i) => {
    const src = due[i];
    if (result.status === 'fulfilled') {
      let records = result.value.filter(Boolean);
      if (src.kind === 'job') records = records.filter(isIndiaEligibleJob);
      next[src.kind].push(...records);
      state.sourceStatus[src.id] = { ok: true, items: records.length, at: new Date().toISOString() };
    } else {
      state.sourceStatus[src.id] = { ok: false, error: result.reason && result.reason.message, at: new Date().toISOString() };
      console.warn(`[resources] ${src.id}: ${result.reason && result.reason.message}`);
    }
  });

  const sheetResults = await Promise.allSettled(SHEET_TABS.map((s) => fetchSheet(s.tab)));
  sheetResults.forEach((result, i) => {
    const { kind, tab } = SHEET_TABS[i];
    if (result.status === 'fulfilled') {
      const records = result.value.map((row) => normalizeSheetRow(row)).filter(Boolean);
      next[kind].push(...records);
      state.sourceStatus[`sheet:${tab}`] = { ok: true, items: records.length, at: new Date().toISOString() };
    } else {
      state.sourceStatus[`sheet:${tab}`] = { ok: false, error: result.reason && result.reason.message, at: new Date().toISOString() };
      console.warn(`[resources] sheet:${tab}: ${result.reason && result.reason.message}`);
    }
  });

  // Merge-not-replace: a source that failed this round keeps its last cards.
  for (const kind of KINDS) {
    state.byKind[kind] = mergeKind(kind, next[kind], state.byKind[kind]);
  }

  // Fire-and-forget: salary/experience enrichment is a nice-to-have (cards
  // already show "not disclosed" gracefully) — don't make every refresh,
  // including the one a cold request blocks on, pay its extra ~7s.
  enrichJobs().catch((err) => console.error('[resources] enrich failed:', err.message));

  state.lastRefresh = new Date().toISOString();
  const total = KINDS.reduce((n, k) => n + state.byKind[k].length, 0);
  console.log(`[resources] ${total} items across ${KINDS.length} kinds`);
}

// Greenhouse's list API carries no description, so salary/experience can't
// be read at list time. Fetch each job's detail page once — capped per
// refresh, marked so a job is only ever looked up once (same pattern as the
// news store's og:image lookups). Only the two extracted facts are kept;
// the description text is discarded.
const ENRICH_PER_REFRESH = 40;

async function enrichJobs() {
  const pending = state.byKind.job
    .filter((r) => r.meta.ghId && !r.meta.enriched)
    .slice(0, ENRICH_PER_REFRESH);
  if (pending.length === 0) return;
  await Promise.allSettled(pending.map(async (r) => {
    try {
      const detail = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${r.meta.ghSlug}/jobs/${r.meta.ghId}`);
      // Greenhouse ships the description HTML-escaped: decode, then strip.
      const text = stripHtml(stripHtml((detail && detail.content) || ''));
      if (!r.meta.experience) r.meta.experience = expFromText(text);
      if (!r.meta.salary) r.meta.salary = salFromText(text);
    } finally {
      r.meta.enriched = true; // one shot, even on fetch failure
    }
  }));
}

// City → match pattern (covers alt spellings; Delhi = NCR).
const CITY_PATTERNS = {
  bengaluru: /bengaluru|bangalore/i,
  mumbai: /mumbai/i,
  hyderabad: /hyderabad/i,
  pune: /pune/i,
  chennai: /chennai/i,
  delhi: /delhi|gurgaon|gurugram|noida/i,
};

function getResources({ kind, page = 1, limit = 24, type = null, q = null, mode = null, city = null, exp = null, category = null, free = null } = {}) {
  let items = state.byKind[kind] || [];
  if (type && type !== 'all') {
    if (kind === 'job') items = items.filter((r) => r.meta.field === type);
  }
  if (category && category !== 'all') {
    items = items.filter((r) => (r.meta.category || '') === category);
  }
  if (free === 'free') items = items.filter((r) => r.meta.free === true);
  if (free === 'paid') items = items.filter((r) => r.meta.free !== true);
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter((r) =>
      `${r.title} ${(r.meta && r.meta.company) || ''} ${(r.meta && r.meta.location) || ''} ${r.source || ''} ${r.blurb || ''}`
        .toLowerCase().includes(needle));
  }
  if (kind === 'job') {
    if (mode) items = items.filter((r) => (r.meta.mode || '').toLowerCase() === String(mode).toLowerCase());
    if (city && CITY_PATTERNS[city]) items = items.filter((r) => CITY_PATTERNS[city].test(r.meta.location || ''));
    if (exp) {
      items = items.filter((r) => {
        const m = (r.meta.experience || '').match(/\d+/);
        if (!m) return false;
        const n = Number(m[0]);
        if (exp === '0-2') return n <= 2;
        if (exp === '3-5') return n >= 3 && n <= 5;
        return n >= 6; // '6+'
      });
    }
  }
  const start = (page - 1) * limit;
  const slice = items.slice(start, start + limit);
  return { items: slice, page, hasMore: start + limit < items.length, total: items.length, lastRefresh: state.lastRefresh };
}

function getCounts() {
  const counts = {};
  for (const [tab, kind] of Object.entries(TAB_TO_KIND)) {
    counts[tab] = (state.byKind[kind] || []).length;
  }
  return counts;
}

function getSnapshot() {
  return { lastRefresh: state.lastRefresh, byKind: state.byKind };
}

function loadSnapshot(snapshot) {
  if (!snapshot || !snapshot.byKind) return false;
  state.byKind = emptyByKind();
  for (const kind of KINDS) state.byKind[kind] = snapshot.byKind[kind] || [];
  state.lastRefresh = snapshot.lastRefresh || new Date().toISOString();
  return true;
}

async function hydrateFromSnapshot() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (!host) return false;
  try {
    const res = await fetch(`https://${host}/api/explore?snapshot=1`, {
      signal: AbortSignal.timeout(2000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return false;
    return loadSnapshot(await res.json());
  } catch {
    return false;
  }
}

// Serverless: serve what's in hand, refresh in the background. `ready` is
// true once we've refreshed at least once (even if some kinds are empty —
// e.g. no sheet configured).
async function ensureReady() {
  const staleNow = () => !state.lastRefresh || Date.now() - new Date(state.lastRefresh).getTime() > REFRESH_INTERVAL_MS;

  if (!state.lastRefresh) await hydrateFromSnapshot();

  if (state.lastRefresh) {
    const background = staleNow() && !state.refreshing
      ? refresh().catch((err) => console.error('[resources] background refresh failed:', err.message))
      : null;
    return { ready: true, background };
  }

  const background = state.refreshing ? refreshPromise : refresh().catch((err) => console.error('[resources] warmup failed:', err.message));
  return { ready: false, background };
}

function start() {
  refresh().catch((err) => console.error('[resources] initial refresh failed:', err.message));
  setInterval(() => refresh().catch((err) => console.error('[resources] refresh failed:', err.message)), REFRESH_INTERVAL_MS);
}

module.exports = {
  start, ensureReady, refresh, getResources, getCounts, getSnapshot, loadSnapshot, state, mergeKind,
};
