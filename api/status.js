// Vercel serverless function: GET /api/status
// Uptime-monitor target: 200 while the store has data, 503 when it doesn't.
// It never starts a feed refresh: a monitor pings this every few minutes around
// the clock, and refetching all 36 feeds on each ping used most of the
// account's CPU allowance. An instance with nothing in memory reports the
// bundled seed, so this answers "is the site up and serving news".
const { store } = require('./_shared');
const { aiEnabled } = require('../src/lib/summarize');

module.exports = async (_req, res) => {
  if (store.state.items.length === 0) store.loadSeed();
  res.setHeader('Cache-Control', 'no-store');
  const health = store.getHealth();
  res.statusCode = health.ok ? 200 : 503;
  res.json({ ...health, aiSummaries: aiEnabled() });
};
