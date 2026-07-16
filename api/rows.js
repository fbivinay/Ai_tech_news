// Vercel serverless function: GET /api/rows — homepage billboard + rails.
const { store, freshen, cacheHeaders } = require('./_shared');

module.exports = async (_req, res) => {
  await freshen();
  cacheHeaders(res);
  res.json(store.getRows());
};
