# ⚡ AI & Tech News

> The fastest way to stay updated on AI and technology. Read concise AI-generated summaries and go directly to the original source for the full story.

A **news discovery and aggregation platform** for AI & technology — not a publisher. The platform never copies, stores, republishes, or displays full news articles. Every card shows a headline, source attribution, and a short AI-generated summary (50–100 words), and links straight to the original publisher, who receives the referral traffic.

## Features

- **Hero story** — one top story selected by an importance score (breaking news, major launches, funding, M&A, policy, security incidents), weighted by source authority and recency decay
- **AI summaries** — neutral, factual, 3–4 lines, generated with Claude (`claude-opus-4-8`) when `ANTHROPIC_API_KEY` is set; a clean extractive fallback otherwise, so the app always works
- **News cards** — headline, source logo + name, summary, published time, category, company tags, region, and a Read Full Article button; clicking anywhere opens the original article in a new tab with a subtle "External link — you are leaving the platform" notice
- **Infinite scroll** with category filtering
- **12 sources** — TechCrunch, The Verge, Ars Technica, VentureBeat, Wired, MIT Technology Review, Engadget, ZDNET, The Register, AI News, MarkTechPost, Google AI Blog
- **Light-first design** (Google News × The Information × Techmeme) with optional dark mode, mobile-first, no popups, no autoplay

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

Feeds refresh every 10 minutes (`REFRESH_INTERVAL_MS` to change).

## Deploy to Vercel

The repo is Vercel-ready out of the box — `public/` is served statically and `api/` runs as serverless functions (no framework preset needed, no build step):

1. Push this repo to GitHub
2. On [vercel.com](https://vercel.com) → **Add New → Project** → import `Ai_tech_news`
3. Leave every setting on its default (Framework Preset: **Other**) and hit **Deploy**
4. Optional: add `ANTHROPIC_API_KEY` under **Project → Settings → Environment Variables** to enable Claude summaries, then redeploy

On Vercel there is no background refresh loop — feeds refresh lazily when a request finds the cache empty or older than 10 minutes, and API responses carry `s-maxage` headers so Vercel's CDN serves most visitors without invoking a function at all. AI summarization is capped at 2 batches (20 newest stories) per refresh to stay inside the function time budget; older stories keep extractive summaries until later refreshes.

## API

| Endpoint | Description |
|---|---|
| `GET /api/feed?page=1&limit=12&category=AI%20Models` | Paginated feed; page 1 of "All" includes the `hero` pick |
| `GET /api/categories` | Category names with counts |
| `GET /api/status` | Item count, last refresh, per-source fetch status, AI on/off |

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

## Compliance by design

- Only headline + a short feed excerpt are processed; **article bodies are never fetched, stored, or displayed**
- Summaries are capped at 100 words and instructed to never copy more than a short phrase verbatim
- All links go directly to the publisher (`rel="noopener external"`, new tab) — no proxying, no read-it-here
- Clear source attribution (name + logo) on every card, plus a site-wide disclosure in the footer
