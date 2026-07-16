// Shared serverless plumbing: keep the response instant by pushing stale
// refreshes into the function's background (waitUntil) instead of blocking.
const store = require('../src/store');

let waitUntil = null;
try {
  ({ waitUntil } = require('@vercel/functions'));
} catch { /* not on Vercel — fall back to fire-and-forget */ }

async function freshen() {
  const background = await store.ensureFresh();
  if (background && waitUntil) waitUntil(background);
}

function cacheHeaders(res) {
  // 1-minute edge cache; for the following 10 minutes stale copies are
  // served instantly while the CDN revalidates in the background — visitors
  // essentially never wait on the origin.
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
}

module.exports = { store, freshen, cacheHeaders };
