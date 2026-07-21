// Vercel serverless function: GET /api/explore
//   ?snapshot=1            → full store dump (cold instances hydrate from this)
//   (no kind)              → { counts, lastRefresh } for the tab bar
//   ?kind=papers&page=1    → paginated cards for a kind
//   ?kind=events&type=...  → events filtered by chip
const resources = require('../src/resources');
const { TAB_TO_KIND } = require('../src/config/resource-sources');
const { waitUntil, cacheHeaders, warmingResponse } = require('./_shared');

module.exports = async (req, res) => {
  const { ready, background } = await resources.ensureReady();
  if (background) {
    if (waitUntil) waitUntil(background);
    else if (!ready) await background;
  }
  if (!ready && !resources.state.lastRefresh) return warmingResponse(res);

  if (req.query.snapshot) {
    cacheHeaders(res);
    return res.json(resources.getSnapshot());
  }

  const kind = TAB_TO_KIND[req.query.kind];
  if (!kind) {
    cacheHeaders(res);
    return res.json({ counts: resources.getCounts(), lastRefresh: resources.state.lastRefresh });
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 24));
  const type = req.query.type || null;
  const str = (v) => (typeof v === 'string' && v ? v.slice(0, 60) : null);

  cacheHeaders(res);
  res.json(resources.getResources({
    kind, page, limit, type,
    q: str(req.query.q), mode: str(req.query.mode), city: str(req.query.city), exp: str(req.query.exp),
    category: str(req.query.category), free: str(req.query.free),
  }));
};
