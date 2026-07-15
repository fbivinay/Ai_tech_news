// Vercel serverless function: GET /api/status
const store = require('../src/store');
const { aiEnabled } = require('../src/lib/summarize');

module.exports = async (_req, res) => {
  await store.ensureFresh();
  res.setHeader('Cache-Control', 's-maxage=60');
  res.json({
    items: store.state.items.length,
    lastRefresh: store.state.lastRefresh,
    aiSummaries: aiEnabled(),
    sources: store.state.sourceStatus,
  });
};
