// Vercel serverless function: GET /api/status
const { store, ensureReadyForRequest } = require('./_shared');
const { aiEnabled } = require('../src/lib/summarize');

module.exports = async (_req, res) => {
  await ensureReadyForRequest();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    items: store.state.items.length,
    lastRefresh: store.state.lastRefresh,
    aiSummaries: aiEnabled(),
    sources: store.state.sourceStatus,
  });
};
