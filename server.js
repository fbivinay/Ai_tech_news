// AI & Tech News — aggregation platform server.
// Serves the static frontend and a small JSON API over the in-memory store.

const path = require('path');
const express = require('express');
const compression = require('compression');
const store = require('./src/store');
const resources = require('./src/resources');
const { aiEnabled } = require('./src/lib/summarize');

const PORT = Number(process.env.PORT || 3000);
const app = express();

app.disable('x-powered-by');
app.use(compression());
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://www.googletagmanager.com https://pagead2.googlesyndication.com https://*.googlesyndication.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com https://*.googlesyndication.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  );
  next();
});
// HTML must always revalidate so asset version bumps (app.js?v=N) reach every
// open tab; the versioned JS/CSS themselves can be cached briefly.
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '5m',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// Paginated feed: /api/feed?page=1&limit=12&category=AI%20Models
app.get('/api/feed', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const category = req.query.category || null;
  res.json(store.getFeed({ page, limit, category }));
});

// Everything the homepage needs in one request + one consistent snapshot
app.get('/api/home', (_req, res) => {
  res.json({
    ...store.getRows(),
    categories: store.getCategories(),
    feed: store.getFeed({ page: 1, limit: 12 }),
  });
});

// Full-store dump (used by serverless instances to hydrate on Vercel)
app.get('/api/snapshot', (_req, res) => {
  res.json(store.getSnapshot());
});

// Homepage rails: billboard hero + Trending Now + one rail per category
app.get('/api/rows', (_req, res) => {
  res.json(store.getRows());
});

app.get('/api/categories', (_req, res) => {
  res.json({ categories: store.getCategories() });
});

// Explore resources: /api/explore, ?kind=papers&page=1, ?kind=events&type=workshop, ?snapshot=1
app.get('/api/explore', (req, res) => {
  const { TAB_TO_KIND } = require('./src/config/resource-sources');
  if (req.query.snapshot) return res.json(resources.getSnapshot());
  const kind = TAB_TO_KIND[req.query.kind];
  if (!kind) return res.json({ counts: resources.getCounts(), lastRefresh: resources.state.lastRefresh });
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 24));
  const type = req.query.type || null;
  const str = (v) => (typeof v === 'string' && v ? v.slice(0, 60) : null);
  res.json(resources.getResources({
    kind, page, limit, type,
    q: str(req.query.q), mode: str(req.query.mode), city: str(req.query.city), exp: str(req.query.exp),
    category: str(req.query.category), free: str(req.query.free),
  }));
});

// Uptime-monitor target: 200 while the store has data, 503 when it doesn't
// (e.g. every source failing) so an external check actually pages someone.
app.get('/api/status', (_req, res) => {
  const health = store.getHealth();
  res.status(health.ok ? 200 : 503).json({ ...health, aiSummaries: aiEnabled() });
});

app.listen(PORT, () => {
  console.log(`AI & Tech News running on http://localhost:${PORT}`);
  store.start();
  resources.start();
});
