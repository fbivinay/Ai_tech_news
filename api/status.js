// Vercel serverless function: GET /api/status
// Uptime-monitor target: 200 while the store has data, 503 when it doesn't
// (e.g. every source failing) so an external check actually pages someone.
const { store, ensureReadyForRequest } = require('./_shared');
const { aiEnabled } = require('../src/lib/summarize');

module.exports = async (_req, res) => {
  await ensureReadyForRequest();
  res.setHeader('Cache-Control', 'no-store');
  const health = store.getHealth();
  res.statusCode = health.ok ? 200 : 503;
  res.json({ ...health, aiSummaries: aiEnabled() });
};
