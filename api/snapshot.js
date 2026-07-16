// Vercel serverless function: GET /api/snapshot — full store dump used by
// cold instances to hydrate from the CDN instead of re-fetching all feeds.
// hydrate:false prevents a cold snapshot instance from calling itself.
const { store, cacheHeaders } = require('./_shared');

let waitUntil = null;
try {
  ({ waitUntil } = require('@vercel/functions'));
} catch { /* not on Vercel */ }

module.exports = async (_req, res) => {
  const background = await store.ensureFresh({ hydrate: false });
  if (background && waitUntil) waitUntil(background);
  cacheHeaders(res);
  res.json(store.getSnapshot());
};
