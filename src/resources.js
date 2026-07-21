// In-memory Explore resources store. Parallel to src/store.js but stripped
// down: no scoring, no Claude summaries, no classification. Fetches live
// feeds + a public Google Sheet every refresh, merges (never replaces, so a
// timed-out source doesn't erase its cards), drops stale items, and serves
// paginated cards per kind.

const { FEED_SOURCES, SHEET_TABS, KINDS, TAB_TO_KIND } = require('./config/resource-sources');
const { fetchFeed } = require('./lib/feed');
const {
  normalizeArxiv, normalizeRemoteOK, normalizeWWR, normalizeDevpost, normalizeSheetRow,
} = require('./lib/resource-normalize');

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
  switch (src.id) {
    case 'remoteok': return normalizeRemoteOK(raw);
    case 'wwr': return normalizeWWR(raw);
    case 'devpost': return normalizeDevpost(raw);
    default: return src.kind === 'paper' ? normalizeArxiv(raw) : null;
  }
}

async function fetchFeedSource(src) {
  if (src.type === 'rss') {
    const feed = await fetchFeed(src.url);
    return (feed.items || []).map((raw) => normalizeFeedItem(src, raw));
  }
  // json
  const data = await fetchJson(src.url);
  let arr = src.arrayPath ? data[src.arrayPath] : data;
  if (!Array.isArray(arr)) arr = [];
  // RemoteOK's first array element is a legal notice, not a job.
  if (src.id === 'remoteok') arr = arr.filter((x) => x && x.position);
  return arr.map((raw) => normalizeFeedItem(src, raw));
}

function sortKind(kind, items) {
  if (kind === 'paper' || kind === 'job') {
    return items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }
  if (kind === 'event') {
    return items.sort((a, b) => new Date(a.date || '2999') - new Date(b.date || '2999'));
  }
  return items; // hackathon / course: keep source order
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

  const feedResults = await Promise.allSettled(FEED_SOURCES.map((src) => fetchFeedSource(src)));
  feedResults.forEach((result, i) => {
    const src = FEED_SOURCES[i];
    if (result.status === 'fulfilled') {
      const records = result.value.filter(Boolean);
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
      const records = result.value.map((row) => normalizeSheetRow(row, kind)).filter(Boolean);
      next[kind].push(...records);
      state.sourceStatus[`sheet:${tab}`] = { ok: true, items: records.length, at: new Date().toISOString() };
    } else {
      state.sourceStatus[`sheet:${tab}`] = { ok: false, error: result.reason && result.reason.message, at: new Date().toISOString() };
      console.warn(`[resources] sheet:${tab}: ${result.reason && result.reason.message}`);
    }
  });

  // Merge-not-replace: a source that failed this round keeps its last cards.
  for (const kind of KINDS) {
    const seen = new Set(next[kind].map((r) => r.id));
    for (const prev of state.byKind[kind]) {
      if (!seen.has(prev.id)) { next[kind].push(prev); seen.add(prev.id); }
    }
    // Re-drop stale events (a previously-future event may now be past).
    let merged = next[kind];
    if (kind === 'event') {
      merged = merged.filter((r) => normalizeSheetRow(
        { title: r.title, link: r.link, type: r.meta.type, date: r.date, mode: r.meta.mode, city: r.meta.city, free: r.meta.free },
        'event',
      ));
    }
    state.byKind[kind] = sortKind(kind, merged).slice(0, MAX_PER_KIND);
  }

  state.lastRefresh = new Date().toISOString();
  const total = KINDS.reduce((n, k) => n + state.byKind[k].length, 0);
  console.log(`[resources] ${total} items across ${KINDS.length} kinds`);
}

function getResources({ kind, page = 1, limit = 24, type = null } = {}) {
  let items = state.byKind[kind] || [];
  if (kind === 'event' && type && type !== 'all') {
    items = items.filter((r) => r.meta.type === type);
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

module.exports = { start, ensureReady, refresh, getResources, getCounts, getSnapshot, loadSnapshot, state };
