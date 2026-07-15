// Vercel serverless function: GET /api/categories
const store = require('../src/store');

module.exports = async (_req, res) => {
  await store.ensureFresh();
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.json({ categories: store.getCategories() });
};
