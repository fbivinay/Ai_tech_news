// Vercel serverless function: GET /api/categories
const { store, ensureReadyForRequest, cacheHeaders, warmingResponse } = require('./_shared');

module.exports = async (_req, res) => {
  if (!(await ensureReadyForRequest())) return warmingResponse(res);
  cacheHeaders(res);
  res.json({ categories: store.getCategories() });
};
