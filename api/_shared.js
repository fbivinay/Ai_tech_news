// Shared serverless plumbing. The contract: a request is answered from data
// already in hand (memory / CDN snapshot / bundled seed) in milliseconds;
// feed refreshing happens strictly in the background via waitUntil. If no
// data source exists at all (should not happen once a seed is bundled),
// the handler sends a "warming" response and the client retries.
const store = require('../src/store');

let waitUntil = null;
try {
  ({ waitUntil } = require('@vercel/functions'));
} catch { /* not on Vercel — fall back below */ }

async function ensureReadyForRequest() {
  const { ready, background } = await store.ensureReady();
  if (background) {
    if (waitUntil) {
      waitUntil(background);
    } else if (!ready) {
      // No background executor available: block once so we make progress.
      await background;
      return store.state.items.length > 0;
    }
  }
  return ready;
}

function cacheHeaders(res) {
  // 1-minute edge cache; for a day after that, stale copies are served
  // instantly while the CDN revalidates in the background.
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=86400');
}

function warmingResponse(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 202;
  res.json({ warming: true });
}

module.exports = { store, waitUntil, ensureReadyForRequest, cacheHeaders, warmingResponse };
