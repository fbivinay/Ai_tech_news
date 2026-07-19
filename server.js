// AI & Tech News — aggregation platform server.
// Serves the static frontend and a small JSON API over the in-memory store.

const path = require('path');
const express = require('express');
const compression = require('compression');
const store = require('./src/store');
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
    "default-src 'self'; script-src 'self' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
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

// Uptime-monitor target: 200 while the store has data, 503 when it doesn't
// (e.g. every source failing) so an external check actually pages someone.
app.get('/api/status', (_req, res) => {
  const health = store.getHealth();
  res.status(health.ok ? 200 : 503).json({ ...health, aiSummaries: aiEnabled() });
});

app.listen(PORT, () => {
  console.log(`AI & Tech News running on http://localhost:${PORT}`);
  store.start();
});
