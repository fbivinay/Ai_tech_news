// Vercel serverless function: GET /api/snapshot — full store dump that cold
// instances use to hydrate from the CDN. Must never hydrate from itself and
// must never block: an empty store answers empty (uncached) while a
// background refresh warms this instance for the next request.
const { store, waitUntil, cacheHeaders } = require('./_shared');

module.exports = async (_req, res) => {
  if (store.state.items.length === 0) {
    try { store.loadSeed?.(); } catch { /* no seed bundled */ }
  }
  if (!store.state.refreshing) {
    const stale = !store.state.lastRefresh ||
      Date.now() - new Date(store.state.lastRefresh).getTime() > 60 * 1000;
    if (stale) {
      const background = store.refresh({ maxSummaryBatches: 0 })
        .catch((err) => console.error('[snapshot] refresh failed:', err.message));
      if (waitUntil) waitUntil(background);
      else if (store.state.items.length === 0) await background;
    }
  }

  if (store.state.items.length > 0) cacheHeaders(res);
  else res.setHeader('Cache-Control', 'no-store');
  res.json(store.getSnapshot());
};
