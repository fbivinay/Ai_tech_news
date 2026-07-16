// Vercel serverless function: GET /api/feed?page=1&limit=12&category=...
const { store, ensureReadyForRequest, cacheHeaders, warmingResponse } = require('./_shared');

module.exports = async (req, res) => {
  if (!(await ensureReadyForRequest())) return warmingResponse(res);

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const category = req.query.category || null;

  cacheHeaders(res);
  res.json(store.getFeed({ page, limit, category }));
};
