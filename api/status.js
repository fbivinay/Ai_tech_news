// Vercel serverless function: GET /api/status
const { store, freshen } = require('./_shared');
const { aiEnabled } = require('../src/lib/summarize');

module.exports = async (_req, res) => {
  await freshen();
  res.setHeader('Cache-Control', 's-maxage=30');
  res.json({
    items: store.state.items.length,
    lastRefresh: store.state.lastRefresh,
    aiSummaries: aiEnabled(),
    sources: store.state.sourceStatus,
  });
};
