# ⚡ AI & Tech News

> The fastest way to stay updated on AI and technology. Read concise AI-generated summaries and go directly to the original source for the full story.

A **news discovery and aggregation platform** for AI & technology — not a publisher. The platform never copies, stores, republishes, or displays full news articles. Every card shows a headline, source attribution, and a short AI-generated summary (50–100 words), and links straight to the original publisher, who receives the referral traffic.

## Features

- **Billboard + Trending** — the top story and a ranked Trending Now rail selected by an importance score (breaking news, major launches, funding, M&A, policy, security incidents), weighted by source authority and recency decay
- **AI summaries** — neutral, factual, 3–4 lines, generated with Claude (`claude-opus-4-8`) when `ANTHROPIC_API_KEY` is set; a clean extractive fallback otherwise, so the app always works
- **News cards** — headline, source logo + name, summary, published time, category, company tags, region, and a Read Full Article button; clicking anywhere opens the original article in a new tab with a subtle "External link — you are leaving the platform" notice
- **Infinite scroll** with category filtering
- **36 sources** — major tech press (TechCrunch, The Verge, Ars Technica, Wired, MIT Tech Review, Engadget, CNET, Gizmodo, Tom's Hardware…), mainstream tech desks (BBC, The Guardian, NYT, CNBC), AI-focused outlets (VentureBeat AI, The Decoder, Google AI, OpenAI, NVIDIA, IEEE Spectrum…), security (Bleeping Computer, The Hacker News, Krebs), and India tech & startups (Economic Times Tech, Inc42)
- **Netflix-style light UI** — billboard hero, horizontal category rails with hover-scale cards and Top-10 rank numerals, red accent, optional dark mode, mobile-first, no popups, no autoplay

## Quick start

```bash
npm install
npm start
# → http://localhost:3000
```

Optional AI summaries:

```bash
cp .env.example .env      # add your ANTHROPIC_API_KEY
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Feeds refresh every minute (`REFRESH_INTERVAL_MS` to change), and the page live-polls every minute, showing a "New stories" pill when fresh news lands.

## Deploy to Vercel

The repo is Vercel-ready out of the box — `public/` is served statically and `api/` runs as serverless functions (no framework preset needed, no build step):

1. Push this repo to GitHub
2. On [vercel.com](https://vercel.com) → **Add New → Project** → import `Ai_tech_news`
3. Leave every setting on its default (Framework Preset: **Other**) and hit **Deploy**
4. Optional: add `ANTHROPIC_API_KEY` under **Project → Settings → Environment Variables** to enable Claude summaries, then redeploy

On Vercel there is no background refresh loop — feeds refresh lazily when a request finds the cache empty or older than 1 minute, and API responses carry `s-maxage` headers so Vercel's CDN serves most visitors without invoking a function at all. Stale data never blocks a request — it is served immediately while the refresh runs in the background (waitUntil). AI summarization is capped at 2 batches (20 newest stories) per refresh; older stories keep extractive summaries until later refreshes.

## API

| Endpoint | Description |
|---|---|
| `GET /api/home` | Everything the homepage boots from in one request: hero, Trending Now, category rails, categories, first feed page |
| `GET /api/rows` | Homepage rails only: billboard hero, Trending Now, category rails |
| `GET /api/feed?page=1&limit=12&category=AI%20Models` | Paginated feed for the Latest Updates grid |
| `GET /api/categories` | Category names with counts |
| `GET /api/snapshot` | Full store dump — used by cold serverless instances to hydrate from the CDN |
| `GET /api/status` | Item count, last refresh, per-source `ok`/`items`/`at`, AI on/off. Returns `503` when the store is empty — safe to point an uptime monitor at |

## Architecture

```
server.js               Express server + JSON API
src/store.js            Feed fetching, dedupe, refresh loop (in-memory)
src/config/sources.js   RSS source list with authority weights
src/lib/classify.js     Category / company / region tagging (keyword rules)
src/lib/score.js        Importance scoring for hero selection
src/lib/summarize.js    Claude batch summarization + extractive fallback
src/lib/text.js         HTML stripping, sentence utilities
public/                 Static frontend (no build step)
```

## Production hardening

- **Security headers** on every response — CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (`vercel.json` in production, matching middleware in `server.js` for local dev)
- **Link sanitization** — `normalizeLink()` in `src/store.js` rejects any RSS-supplied link that isn't `http(s)`, so a compromised or malicious feed can't smuggle a `javascript:` URI into a card's link
- **SEO basics** — `robots.txt`, `sitemap.xml`, and Open Graph/Twitter Card meta tags ship in `public/`
- **Monitoring-ready `/api/status`** — returns `503` (not a hardcoded `200`) when the store has no items, and never exposes internal per-source fetch-error text, so it's safe to wire up to an external uptime monitor (e.g. UptimeRobot)

## Compliance by design

- Only headline + a short feed excerpt are processed; **article bodies are never fetched, stored, or displayed**
- Summaries are capped at 100 words and instructed to never copy more than a short phrase verbatim
- All links go directly to the publisher (`rel="noopener external"`, new tab) — no proxying, no read-it-here
- Clear source attribution (name + logo) on every card, plus a site-wide disclosure in the footer
