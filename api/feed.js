// Vercel serverless function: GET /api/feed?page=1&limit=12&category=...
const store = require('../src/store');

module.exports = async (req, res) => {
  await store.ensureFresh();

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const category = req.query.category || null;

  // Edge-cache the response so most visitors are served from the CDN
  // without invoking this function (and stale content revalidates quietly).
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.json(store.getFeed({ page, limit, category }));
};
