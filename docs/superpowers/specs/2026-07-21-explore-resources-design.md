# Explore — Resources Aggregator (Phase 1)

**Date:** 2026-07-21
**Status:** Approved design, pre-implementation

## Goal

Add an **Explore** area to AI & Tech News surfacing AI/tech **papers, jobs,
events (conferences / workshops / sessions), courses, and hackathons** — each
as a headline + short blurb card that links out to the source. Extends the
platform's existing "discover & link out, never republish" model to
non-news content.

## Hard constraints

1. **Everything auto-updates. No manual staleness.** Every kind pulls from a
   *live* source on the background refresh cycle — no data is baked into the
   deployment as the primary source. Editing curated content (courses,
   workshops) must go live **without a redeploy**.
2. **Compliance unchanged.** Only headline + short blurb + attribution +
   outbound link (`rel="noopener external"`, new tab, external-link toast).
   Never store or display full bodies. Blurbs are either the feed excerpt
   (truncated) or our own short curated text.
3. **News store untouched.** Resources live in a separate store. No resource
   ever touches news scoring, Claude summarization, or classification.
4. **No new API keys, no paid APIs, no database.** Fits the current no-DB,
   no-secrets model. (One optional env var for the Google Sheet URL.)

## Content kinds & live sources

| Kind | Tab | Live source (auto-updating) | Notes |
|---|---|---|---|
| Papers | Papers | arXiv RSS (`cs.AI`, `cs.LG`, `cs.CL`) | Feed reuse |
| Jobs | Jobs | RemoteOK JSON API + WeWorkRemotely RSS | No key |
| Hackathons | Hackathons | Devpost JSON API (`/api/hackathons`) | Drop `open_state == ended` |
| Conferences / Workshops / Sessions | Events (chips) | **Google Sheet → published JSON** (`events` tab, `type` column) | User-editable, no redeploy |
| Courses / certs | Courses | **Google Sheet → published JSON** (`courses` tab) | User-editable, no redeploy |

The Google Sheet is published as JSON (gviz endpoint, no key). One spreadsheet,
two tabs: `events` (with a `type` column = conference/workshop/session) and
`courses`. The app refetches it every cycle → a row edit is live within one
refresh interval. The app tolerates the sheet being missing, empty, or
unreachable (renders whatever else is available). Sheet id via env
`EXPLORE_SHEET_ID`; unset → those tabs are simply empty.

**Dropped from Phase 1** (noted for later, not built now): HN "who's hiring"
(needs monthly-thread scraping) and `confs.tech` (events come from the Sheet
instead — fewer moving parts, still live).

## Data model

One normalized record shape, discriminated by `kind`:

```js
{
  id,          // sha1(link).slice(0,16)
  kind,        // 'paper' | 'job' | 'event' | 'course' | 'hackathon'
  title,
  link,        // outbound, normalized
  source,      // display name of origin
  blurb,       // short: truncated feed excerpt or curated text
  image,       // optional
  date,        // ISO — publishedAt (papers/jobs) or event/deadline date
  meta: {}     // kind-specific, below
}
```

`meta` by kind:
- **paper** — `{ authors, categories }`
- **job** — `{ company, location, remote }`
- **event** — `{ type: 'conference'|'workshop'|'session', mode: 'online'|'in-person', city, free, endsAt }`
- **course** — `{ provider, level, cert }`
- **hackathon** — `{ deadline, mode, prize }`

## Architecture

### Backend

**`src/resources.js`** — a parallel mini-store, structurally similar to
`src/store.js` but stripped down:
- State: `byKind` (Map kind → array), `lastRefresh`, `refreshing`,
  `sourceStatus`.
- `refresh()` — merge-not-replace per kind (a source that times out must not
  erase its cards, same invariant as news). Drops records whose event date /
  deadline is in the past. Bounds each kind's list length.
- No scoring, no Claude, no `classify`. Sorting: papers/jobs by `date` desc;
  events/hackathons by upcoming date asc (soonest first); courses in source
  order.
- Reuses `fetchFeed` and helpers from `src/store.js` where a source is
  RSS/Atom (export them or move shared bits to `src/lib/text.js` /
  a small `src/lib/feed.js`). JSON sources (RemoteOK, HN Algolia, confs.tech,
  Google Sheet) get their own tiny fetch+normalize functions.
- `getResources({ kind, page, limit })` and `getCounts()` for the API.
- `getSnapshot()` / `loadSnapshot()` so cold serverless instances hydrate
  from the CDN copy instead of re-fetching every source (mirrors news).

**`src/config/resource-sources.js`** — declarative source list: each entry is
`{ kind, type: 'rss'|'json', url, ...parserHints }`. The Google Sheet URL and
`confs.tech` URL live here (sheet URL overridable via env
`EXPLORE_SHEET_URL`).

### API

**`api/explore.js`** (Vercel function) + matching Express route in
`server.js`:
- `GET /api/explore` → `{ counts: { papers, jobs, events, courses, hackathons }, lastRefresh }` for the tab bar.
- `GET /api/explore?kind=papers&page=1&limit=24` → `{ items, page, hasMore, total }`.
- `GET /api/explore?kind=events&type=workshop` → events filtered by chip.
- Same CDN cache headers + background-refresh-via-`waitUntil` pattern as
  existing endpoints (reuse `_shared.js`). Request path never blocks on
  fetching; serves memory → snapshot, refreshes in background.

### Refresh wiring

- Local (`server.js`): resources refresh on the same `setInterval` as news
  (or its own interval; same `REFRESH_INTERVAL_MS`).
- Serverless: `api/explore.js` triggers a background resources refresh via
  `waitUntil` when data is stale, exactly like the news endpoints.
- Cold start: hydrate resources from `/api/snapshot`-style CDN copy; if
  absent, first request serves empty tabs and the background refresh fills
  them within one cycle. (Acceptable brief empty state; auto-update holds.)

### Frontend

- **`public/explore.html`** — new page, reuses `styles.css`, the header, the
  external-link toast, cookie/consent gate. Header nav gains an **Explore**
  link (added to `index.html` and `explore.html`; `explore.html` links back
  to Home).
- **`public/explore.js`** — reuses the `el()` helper and the card component
  pattern from `app.js`. Renders the tab bar (Papers · Jobs · Events ·
  Courses · Hackathons), fetches `/api/explore?kind=` on tab switch, renders a
  card grid with load-more / infinite scroll (same UX as the news feed). The
  **Events** tab shows type chips: All / Conferences / Workshops / Sessions.
- Cards are kind-aware: a job card shows company · location; an event card
  shows date · mode · city; a course shows provider · level · "Free" / cert
  badge; a paper shows authors; a hackathon shows deadline. All link out.
- Tab and chip selection reflected in the URL query (`?kind=jobs`) so a view
  is shareable and reload-stable.

## Error handling

- Any single source failing is tolerated (merge-not-replace keeps its last
  good cards; `sourceStatus` records the failure, surfaced in `/api/status`).
- Google Sheet missing/unreachable/empty → that kind renders whatever cards
  survive; no crash, no blank error.
- Malformed feed entries are skipped (same normalize-returns-null pattern as
  news).
- Empty tab → friendly "Nothing here right now, check back soon" note (reuse
  the existing empty-note styling).

## Testing / verification

No test framework in the repo. Verification per the project's convention:
- One runnable self-check script (`node`-based, `assert`) for the resource
  normalizers: feed/JSON fixture in → expected normalized record out, and
  past-dated events get dropped. (The parser is non-trivial logic → it earns
  one check.)
- Manual: `npm start`, hit `/api/explore` and `/api/explore?kind=…`, load
  `/explore.html`, switch tabs + Events chips, confirm outbound links + toast,
  confirm a Google Sheet row edit appears after one refresh.

## Out of scope (later phases)

- **Engagement:** Save-for-later, Follow-topics (frontend, localStorage).
- **Weekly digest:** derived from existing news scoring.
- **Launches:** Product Hunt (paid key) / GitHub Trending (no official API).
- **Talks / podcasts:** YouTube channel RSS.

## Deliberate ceilings (`ponytail:`)

- **SEO:** Explore is client-rendered → weak crawlability. Acceptable for now;
  add prerender/SSR only if these pages need to rank (e.g. for AdSense
  traffic).
- **Google Sheet coupling:** courses/workshops depend on one external sheet
  staying published. Documented setup step; app degrades gracefully if it's
  gone.
- **`confs.tech` dependency:** relies on that community dataset staying
  available; if it dies, conferences fall back to the Google Sheet.
