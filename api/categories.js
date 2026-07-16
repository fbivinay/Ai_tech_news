// Vercel serverless function: GET /api/categories
const { store, freshen, cacheHeaders } = require('./_shared');

module.exports = async (_req, res) => {
  await freshen();
  cacheHeaders(res);
  res.json({ categories: store.getCategories() });
};
