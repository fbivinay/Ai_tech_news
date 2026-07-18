// Vercel serverless function: GET /api/home — everything the homepage needs
// in ONE request from ONE consistent snapshot. Always answers instantly;
// never waits on feed fetching — EXCEPT ?fresh=1, the boot request, which
// blocks (time-bounded) on one summary-free refresh so a visitor's first
// paint is the latest news, never a stale CDN/seed copy.
const { store, ensureReadyForRequest, cacheHeaders, warmingResponse } = require('./_shared');

module.exports = async (req, res) => {
  const wantFresh = /[?&]fresh=1/.test(req.url || '');

  if (wantFresh) {
    // Deliberately skips ensureReadyForRequest(): that would kick off a
    // background refresh WITH a Claude summary batch, and ensureFresh would
    // then be stuck awaiting that same in-flight 30s+ call. Later polls
    // (plain /api/home) still schedule AI summarization.
    await store.ensureFresh();
    if (store.state.items.length === 0) return warmingResponse(res);
    res.setHeader('Cache-Control', 'no-store');
  } else {
    if (!(await ensureReadyForRequest())) return warmingResponse(res);
    cacheHeaders(res);
  }

  res.json({
    ...store.getRows(),
    categories: store.getCategories(),
    feed: store.getFeed({ page: 1, limit: 12 }),
  });
};
