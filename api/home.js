// Vercel serverless function: GET /api/home — everything the homepage needs
// in ONE request from ONE consistent snapshot. Always answers instantly;
// never waits on feed fetching.
const { store, ensureReadyForRequest, cacheHeaders, warmingResponse } = require('./_shared');

module.exports = async (_req, res) => {
  if (!(await ensureReadyForRequest())) return warmingResponse(res);
  cacheHeaders(res);
  res.json({
    ...store.getRows(),
    categories: store.getCategories(),
    feed: store.getFeed({ page: 1, limit: 12 }),
  });
};
