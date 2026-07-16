// Vercel serverless function: GET /api/home — everything the homepage needs
// in ONE request and ONE consistent data snapshot: billboard hero, trending,
// category rails, the fixed category taxonomy, and the first grid page.
const { store, freshen, cacheHeaders } = require('./_shared');

module.exports = async (_req, res) => {
  await freshen();
  cacheHeaders(res);
  res.json({
    ...store.getRows(),
    categories: store.getCategories(),
    feed: store.getFeed({ page: 1, limit: 12 }),
  });
};
