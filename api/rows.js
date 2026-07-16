// Vercel serverless function: GET /api/rows — kept for API compatibility;
// the frontend now uses /api/home.
const { store, ensureReadyForRequest, cacheHeaders, warmingResponse } = require('./_shared');

module.exports = async (_req, res) => {
  if (!(await ensureReadyForRequest())) return warmingResponse(res);
  cacheHeaders(res);
  res.json(store.getRows());
};
