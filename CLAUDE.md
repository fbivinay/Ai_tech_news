# Update Bro! — project guide

A **news discovery & aggregation platform** (Google News style, Netflix-inspired UI) for AI & technology. Core legal/product rule: **never store, republish, or display full article bodies** — only headline + short AI summary + attribution, always linking to the original publisher.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js ≥ 18, CommonJS | No build step anywhere |
| Backend | Express (local dev) + Vercel serverless functions (`api/*.js`) in production | Both share the same store code |
| Data | In-memory store fed by RSS/Atom feeds (`rss-parser`), no database | 36 sources in `src/config/sources.js` |
| AI | Claude (`claude-opus-4-8`) via `@anthropic-ai/sdk` for 40–70-word summaries; **optional** — clean extractive fallback when `ANTHROPIC_API_KEY` is unset | JSON-schema constrained output, batches of 10 |
| Frontend | Vanilla HTML/CSS/JS in `public/` — zero frameworks, zero dependencies | Netflix-style light theme, dark mode toggle |
| Hosting | Vercel (auto-deploys pushes to the default branch) | `vercel.json` sets function `maxDuration` |

## Commands

```bash
npm install            # setup
npm start              # local server on :3000 (background refresh every 60s)
npm run build:seed     # regenerate data/seed.json (bundled news bootstrap)
```

No tests, no linter configured yet. Verify changes by running `npm start` and checking `/api/status`, `/api/home`, and the homepage.

## Architecture

```
server.js               Express wrapper for local dev (compression, static, API routes)
api/                    Vercel serverless functions (production API)
  _shared.js            ensureReadyForRequest() + cache headers + warming response
  home.js               ONE call the homepage boots from: hero+trending+rails+categories+grid p1
  feed.js               paginated grid (infinite scroll / category filter)
  snapshot.js           full store dump — cold instances hydrate from the CDN copy of this
  rows.js, categories.js, status.js
  explore.js            Explore resources: papers/jobs/courses/hackathons (src/resources.js)
src/store.js            THE core: fetch/merge/dedupe/refresh, getRows/getFeed/getSnapshot,
                        ensureReady() bootstrap chain
src/config/sources.js   RSS source list with authority weights
src/lib/classify.js     keyword rules → category / company tags / region
src/lib/score.js        importance scoring (hero + trending), roundup/deals penalty
src/lib/summarize.js    Claude batch summaries + extractive fallback
src/lib/text.js         HTML stripping, sentence utils
data/seed.json          news snapshot bundled into the deployment (see below)
public/                 static frontend: index.html, styles.css, app.js
scripts/build-seed.js   regenerates data/seed.json
```

## Non-negotiable invariants (learned the hard way)

1. **The request path never blocks on feed fetching — except the boot request.** `/api/home?fresh=1` (what `boot()` in `public/app.js` calls) deliberately blocks on one summary-free refresh via `store.ensureFresh()` (12s budget) so a first visit always paints the latest news instead of a stale CDN/seed copy. Every other request answers instantly: memory → CDN `/api/snapshot` (2s cap) → bundled `data/seed.json`, with real refreshing in the background via `waitUntil` (`@vercel/functions`). Claude summarization is background-only (max 1 batch) — an Opus call can take 30s+ and must never sit in front of a response, which is also why the fresh path skips `ensureReadyForRequest()`.
2. **Refreshes merge, never replace** (`src/store.js`). A source that times out must not erase its stories — that used to make whole homepage sections vanish between reloads.
3. **Sections are a fixed taxonomy** (`SECTION_ORDER` in `src/store.js`). Rails and category chips always render in canonical order so the UI never reshuffles.
4. **The frontend never re-renders under the reader.** New data is offered via the red "New stories" pill (`offerUpdate()` in `public/app.js`), not applied automatically.
5. **Compliance:** summaries capped at 100 words; only headline + feed excerpt are ever processed; every link goes directly to the publisher (`rel="noopener external"`, new tab) with an external-link toast.

## Environment variables

```
ANTHROPIC_API_KEY     optional — enables Claude summaries (extractive fallback otherwise)
SUMMARY_MODEL         default claude-opus-4-8
REFRESH_INTERVAL_MS   default 60000
PORT                  default 3000 (local only)
EXPLORE_SHEET_ID      optional — Google Sheet id for Explore courses (see docs/explore-google-sheet.md)
```

On Vercel, set `ANTHROPIC_API_KEY` in Project → Settings → Environment Variables.

## Deployment

Pushing to the default branch (`claude/news-aggregation-platform-fow2iw`) auto-deploys on Vercel. `public/` is served statically; `api/*.js` become functions. Consider running `npm run build:seed` before big deploys so the bundled bootstrap news is fresh (not required — it self-updates in the background).

## Conventions

- CommonJS (`require`/`module.exports`) throughout; no TypeScript, no bundler.
- Frontend: no frameworks — DOM built with the small `el()` helper in `app.js`; animations are transform/opacity only and must respect `prefers-reduced-motion`.
- All UI theming goes through CSS custom properties in `:root` / `html[data-theme='dark']` (light is the default theme).
- New RSS sources: add to `src/config/sources.js` and verify the feed parses before committing (sources that fail are tolerated at runtime but shouldn't be added knowingly broken).
