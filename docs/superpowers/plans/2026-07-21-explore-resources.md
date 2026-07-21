# Explore — Resources Aggregator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an auto-updating **Explore** area (Papers · Jobs · Events · Courses · Hackathons) that surfaces AI/tech resources as link-out cards, without touching the existing news pipeline.

**Architecture:** A second in-memory store (`src/resources.js`) parallel to the news store, fed by live RSS/JSON feeds and a public Google Sheet. Pure per-kind normalizers turn each source into one shared record shape. One serverless endpoint (`api/explore.js`) + one Express route serve paginated cards. A self-contained `public/explore.html` + `explore.js` render a tabbed page reusing the existing card look.

**Tech Stack:** Node.js CommonJS, `rss-parser`, native `fetch`, vanilla JS frontend, Vercel serverless + Express local — all already in the repo. No new dependencies.

## Global Constraints

- **Runtime:** Node ≥ 18, CommonJS (`require`/`module.exports`). No build step, no TypeScript, no bundler.
- **No new dependencies.** Reuse `rss-parser` and native `fetch` only.
- **Never block the request path on fetching.** Serve memory → CDN snapshot; refresh in background via `waitUntil` (serverless) or `setInterval` (local). Same rule as news.
- **News store untouched.** No resource touches news scoring, Claude summaries, or `classify`.
- **Compliance:** cards are headline + short blurb (≤ 40 words) + attribution + outbound link only. Every link opens a new tab with `rel="noopener external"` and the external-link toast. Never store or display full bodies.
- **Auto-update is mandatory.** Every kind pulls a live source each refresh cycle; nothing is baked into the deployment as the primary source.
- **Record shape (canonical):**
  ```js
  { id, kind, title, link, source, blurb, image, date, meta }
  // kind: 'paper' | 'job' | 'event' | 'course' | 'hackathon'
  ```
- **Env:** `EXPLORE_SHEET_ID` (optional) — Google Sheet id for events/courses. Unset → those tabs empty, no error.
- **Blurb cap:** `truncateWords(text, 40)` from `src/lib/text.js`.

---

### Task 1: Extract shared feed helper

Pull the RSS fetch + `hashId` + `normalizeLink` helpers out of `src/store.js` into a shared module so the resources store can reuse them without duplicating the sanitize/timeout/user-agent logic.

**Files:**
- Create: `src/lib/feed.js`
- Modify: `src/store.js` (import from the new module, delete the moved copies)
- Test: `test/feed.test.js`

**Interfaces:**
- Produces:
  - `fetchFeed(url)` → `Promise<ParsedFeed>` (rss-parser output; throws on HTTP error/timeout)
  - `hashId(str)` → `string` (16-char sha1 hex)
  - `normalizeLink(link)` → `string | null` (https(s) only, strips utm/fbclid/gclid/ref + hash)
  - `BROWSER_UA` → `string`

- [ ] **Step 1: Write the failing test**

```js
// test/feed.test.js
const assert = require('assert');
const { hashId, normalizeLink } = require('../src/lib/feed');

// hashId is deterministic + 16 hex chars
assert.strictEqual(hashId('https://example.com/a'), hashId('https://example.com/a'));
assert.match(hashId('x'), /^[0-9a-f]{16}$/);

// normalizeLink strips tracking params + hash, rejects non-http
assert.strictEqual(normalizeLink('https://x.com/p?utm_source=rss&id=5#frag'), 'https://x.com/p?id=5');
assert.strictEqual(normalizeLink('javascript:alert(1)'), null);
assert.strictEqual(normalizeLink('not a url'), null);

console.log('feed.test OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/feed.test.js`
Expected: FAIL — `Cannot find module '../src/lib/feed'`

- [ ] **Step 3: Create `src/lib/feed.js`**

```js
// Shared feed plumbing: RSS/Atom fetch (sanitized, timed-out, browser UA),
// stable id hashing, and tracking-free link normalization. Used by both the
// news store and the resources store.

const crypto = require('crypto');
const Parser = require('rss-parser');

const FETCH_TIMEOUT_MS = 7000;

// Several publishers 403 non-browser user agents on their public endpoints.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['content:encoded', 'contentEncoded'],
    ],
  },
});

function hashId(str) {
  return crypto.createHash('sha1').update(str).digest('hex').slice(0, 16);
}

function normalizeLink(link) {
  try {
    const url = new URL(link);
    if (!/^https?:$/i.test(url.protocol)) return null;
    url.hash = '';
    for (const param of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$)/i.test(param)) url.searchParams.delete(param);
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchFeed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': BROWSER_UA,
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    // Escape stray ampersands that aren't part of an entity — some feeds ship
    // malformed XML that the strict parser would otherwise reject outright.
    const sanitized = xml.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
    return await parser.parseString(sanitized);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchFeed, hashId, normalizeLink, BROWSER_UA };
```

- [ ] **Step 4: Refactor `src/store.js` to use the shared module**

In `src/store.js`, replace the top-of-file `crypto`/`Parser` setup and the local `hashId`, `normalizeLink`, `parser`, `BROWSER_UA`, `fetchFeed` definitions with an import. Specifically:

Delete lines defining `const crypto = require('crypto');`, `const Parser = require('rss-parser');`, the `parser` const, `hashId`, `normalizeLink`, `BROWSER_UA`, and `fetchFeed(source)`.

Add near the other requires:

```js
const { fetchFeed, hashId, normalizeLink, BROWSER_UA } = require('./lib/feed');
```

The old `fetchFeed` took a `source` object; the new one takes a URL. Update its single call site in `doRefresh`:

```js
// before: SOURCES.map((source) => fetchFeed(source))
const results = await Promise.allSettled(SOURCES.map((source) => fetchFeed(source.url)));
```

`fetchOgImage` still uses `BROWSER_UA` (now imported) — no other change.

- [ ] **Step 5: Run test + smoke-check news still boots**

Run: `node test/feed.test.js`
Expected: `feed.test OK`

Run: `node -e "require('./src/store')"`
Expected: no error (module loads clean).

- [ ] **Step 6: Commit**

```bash
git add src/lib/feed.js src/store.js test/feed.test.js
git commit -m "refactor: extract shared feed helpers into src/lib/feed.js"
```

---

### Task 2: Resource source config

Declarative list of live sources. Pure data — no functions, no fetching.

**Files:**
- Create: `src/config/resource-sources.js`

**Interfaces:**
- Produces:
  - `FEED_SOURCES` → `Array<{ id, kind, type: 'rss'|'json', url, arrayPath? }>`
  - `SHEET_TABS` → `Array<{ kind: 'event'|'course', tab: string }>`
  - `KINDS` → `['paper','job','event','course','hackathon']`
  - `TAB_TO_KIND` → `{ papers:'paper', jobs:'job', events:'event', courses:'course', hackathons:'hackathon' }`

- [ ] **Step 1: Create `src/config/resource-sources.js`**

```js
// Live sources for the Explore resources store. Feed sources are fetched
// every refresh cycle; sheet tabs are pulled from the public Google Sheet
// (EXPLORE_SHEET_ID). Everything here auto-updates — nothing is bundled.

const ARXIV_CATEGORIES = ['cs.AI', 'cs.LG', 'cs.CL'];

const FEED_SOURCES = [
  ...ARXIV_CATEGORIES.map((cat) => ({
    id: `arxiv-${cat}`,
    kind: 'paper',
    type: 'rss',
    url: `http://export.arxiv.org/rss/${cat}`,
  })),
  { id: 'remoteok', kind: 'job', type: 'json', url: 'https://remoteok.com/api', arrayPath: null },
  { id: 'wwr', kind: 'job', type: 'rss', url: 'https://weworkremotely.com/categories/remote-programming-jobs.rss' },
  { id: 'devpost', kind: 'hackathon', type: 'json', url: 'https://devpost.com/api/hackathons', arrayPath: 'hackathons' },
];

// Google Sheet tabs (curated but live-editable). Requires EXPLORE_SHEET_ID.
const SHEET_TABS = [
  { kind: 'event', tab: 'events' },
  { kind: 'course', tab: 'courses' },
];

const KINDS = ['paper', 'job', 'event', 'course', 'hackathon'];

const TAB_TO_KIND = {
  papers: 'paper',
  jobs: 'job',
  events: 'event',
  courses: 'course',
  hackathons: 'hackathon',
};

module.exports = { FEED_SOURCES, SHEET_TABS, KINDS, TAB_TO_KIND };
```

- [ ] **Step 2: Verify it loads**

Run: `node -e "console.log(require('./src/config/resource-sources').FEED_SOURCES.length)"`
Expected: `6`

- [ ] **Step 3: Commit**

```bash
git add src/config/resource-sources.js
git commit -m "feat: add Explore resource source config"
```

---

### Task 3: Per-kind normalizers (the core)

Pure functions: raw source object → canonical record (or `null` to drop). No network, so fully unit-testable. This is the heart of the feature and earns the one runnable check.

**Files:**
- Create: `src/lib/resource-normalize.js`
- Test: `test/resource-normalize.test.js`

**Interfaces:**
- Consumes: `hashId`, `normalizeLink` from `src/lib/feed.js`; `stripHtml`, `truncateWords` from `src/lib/text.js`.
- Produces (all return a record `{id,kind,title,link,source,blurb,image,date,meta}` or `null`):
  - `makeRecord({ kind, title, link, source, blurb, image, date, meta })`
  - `normalizeArxiv(entry)`
  - `normalizeRemoteOK(job)`
  - `normalizeWWR(entry)`
  - `normalizeDevpost(h)`
  - `normalizeSheetRow(row, kind)` — `row` is a flat `{ label: value }` object from the sheet

- [ ] **Step 1: Write the failing test**

```js
// test/resource-normalize.test.js
const assert = require('assert');
const {
  makeRecord, normalizeArxiv, normalizeRemoteOK, normalizeWWR,
  normalizeDevpost, normalizeSheetRow,
} = require('../src/lib/resource-normalize');

// makeRecord drops records with no usable link or title
assert.strictEqual(makeRecord({ kind: 'paper', title: 'x', link: 'not a url' }), null);
assert.strictEqual(makeRecord({ kind: 'paper', title: '', link: 'https://x.com' }), null);

// arXiv: strips the trailing "(arXiv:...)" from the title
const paper = normalizeArxiv({
  title: 'Deep Nets Are Great. (arXiv:2401.00001v1 [cs.AI])',
  link: 'https://arxiv.org/abs/2401.00001',
  contentSnippet: 'We show that deep nets are great.',
  creator: 'Ada Lovelace, Alan Turing',
  isoDate: '2026-07-01T00:00:00Z',
});
assert.strictEqual(paper.kind, 'paper');
assert.strictEqual(paper.title, 'Deep Nets Are Great.');
assert.strictEqual(paper.meta.authors, 'Ada Lovelace, Alan Turing');

// RemoteOK: maps position/company/url
const job = normalizeRemoteOK({ position: 'ML Engineer', company: 'Acme', url: 'https://remoteok.com/j/1', location: 'Worldwide', date: '2026-07-01' });
assert.strictEqual(job.kind, 'job');
assert.strictEqual(job.title, 'ML Engineer');
assert.strictEqual(job.meta.company, 'Acme');

// WWR: splits "Company: Role" title
const wwr = normalizeWWR({ title: 'Acme: Senior Backend Engineer', link: 'https://weworkremotely.com/j/2', contentSnippet: 'Remote role' });
assert.strictEqual(wwr.title, 'Senior Backend Engineer');
assert.strictEqual(wwr.meta.company, 'Acme');

// Devpost: ended hackathons are dropped, live ones kept
assert.strictEqual(normalizeDevpost({ title: 'Old', url: 'https://devpost.com/h/1', open_state: 'ended' }), null);
const hack = normalizeDevpost({ title: 'AI Jam', url: 'https://devpost.com/h/2', open_state: 'open', submission_period_dates: 'Aug 1 - Aug 30, 2026', prize_amount: '<span>$10,000</span>', online: true });
assert.strictEqual(hack.kind, 'hackathon');
assert.strictEqual(hack.meta.deadline, 'Aug 1 - Aug 30, 2026');
assert.strictEqual(hack.meta.mode, 'online');

// Sheet events: past-dated events are dropped
assert.strictEqual(
  normalizeSheetRow({ title: 'Old Conf', link: 'https://x.com/c', type: 'Conference', date: '2000-01-01' }, 'event'),
  null,
);
const evt = normalizeSheetRow({ title: 'Future Conf', link: 'https://x.com/c2', type: 'Workshop', date: '2099-01-01', city: 'Berlin', mode: 'in-person', free: 'yes' }, 'event');
assert.strictEqual(evt.kind, 'event');
assert.strictEqual(evt.meta.type, 'workshop');
assert.strictEqual(evt.meta.free, true);

// Sheet courses: cert flag parsed
const course = normalizeSheetRow({ title: 'Intro to ML', link: 'https://x.com/course', provider: 'DeepLearning.AI', level: 'Beginner', cert: 'Yes' }, 'course');
assert.strictEqual(course.kind, 'course');
assert.strictEqual(course.meta.cert, true);
assert.strictEqual(course.source, 'DeepLearning.AI');

console.log('resource-normalize.test OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/resource-normalize.test.js`
Expected: FAIL — `Cannot find module '../src/lib/resource-normalize'`

- [ ] **Step 3: Create `src/lib/resource-normalize.js`**

```js
// Pure normalizers: one per source shape → the canonical Explore record.
// No network here, so this file is unit-testable in isolation. Returning
// null drops the item (bad link, missing title, past-dated event, ended
// hackathon).

const { hashId, normalizeLink } = require('./feed');
const { stripHtml, truncateWords } = require('./text');

const BLURB_WORDS = 40;

function makeRecord({ kind, title, link, source, blurb, image, date, meta }) {
  const url = normalizeLink(link || '');
  const cleanTitle = stripHtml(title || '');
  if (!url || !cleanTitle) return null;
  return {
    id: hashId(url),
    kind,
    title: cleanTitle,
    link: url,
    source: source || '',
    blurb: truncateWords(stripHtml(blurb || ''), BLURB_WORDS),
    image: image || null,
    date: date || null,
    meta: meta || {},
  };
}

const truthy = (v) => /^(y|yes|true|free|1)$/i.test(String(v == null ? '' : v).trim());

function normalizeArxiv(entry) {
  const title = (entry.title || '').replace(/\.?\s*\(arXiv:[^)]*\)\s*$/i, '').trim();
  const authors = String(entry.creator || entry['dc:creator'] || '')
    .split(/,\s*/).filter(Boolean).slice(0, 4).join(', ');
  return makeRecord({
    kind: 'paper',
    title,
    link: entry.link || entry.guid,
    source: 'arXiv',
    blurb: entry.contentSnippet || entry.summary || entry.content || '',
    date: entry.isoDate || entry.pubDate || null,
    meta: { authors, categories: entry.categories || [] },
  });
}

function normalizeRemoteOK(job) {
  if (!job || !job.position) return null;
  return makeRecord({
    kind: 'job',
    title: job.position,
    link: job.url || job.apply_url,
    source: 'RemoteOK',
    blurb: job.description || (Array.isArray(job.tags) ? job.tags.join(', ') : ''),
    image: job.company_logo || job.logo || null,
    date: job.date || null,
    meta: { company: job.company || '', location: job.location || 'Remote', remote: true },
  });
}

function normalizeWWR(entry) {
  // WWR titles are "Company: Role"
  const raw = entry.title || '';
  const idx = raw.indexOf(':');
  const company = idx > -1 ? raw.slice(0, idx).trim() : '';
  const role = idx > -1 ? raw.slice(idx + 1).trim() : raw;
  return makeRecord({
    kind: 'job',
    title: role,
    link: entry.link,
    source: 'WeWorkRemotely',
    blurb: entry.contentSnippet || entry.summary || '',
    date: entry.isoDate || entry.pubDate || null,
    meta: { company, location: 'Remote', remote: true },
  });
}

function normalizeDevpost(h) {
  if (!h || h.open_state === 'ended') return null;
  let image = h.thumbnail_url || null;
  if (image && image.startsWith('//')) image = `https:${image}`;
  const prize = h.prize_amount ? stripHtml(h.prize_amount) : '';
  const location = h.displayed_location && h.displayed_location.location;
  const blurb = [location, prize && `${prize} in prizes`].filter(Boolean).join(' · ');
  return makeRecord({
    kind: 'hackathon',
    title: h.title,
    link: h.url,
    source: 'Devpost',
    blurb,
    image,
    date: null,
    meta: {
      deadline: h.submission_period_dates || '',
      mode: h.online ? 'online' : 'in-person',
      prize,
    },
  });
}

function isPast(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function normalizeSheetRow(row, kind) {
  if (kind === 'event') {
    if (isPast(row.date)) return null;
    return makeRecord({
      kind: 'event',
      title: row.title,
      link: row.link,
      source: row.source || 'Community',
      blurb: row.blurb || '',
      image: row.image || null,
      date: row.date || null,
      meta: {
        type: String(row.type || 'conference').toLowerCase().trim(),
        mode: row.mode || '',
        city: row.city || '',
        free: truthy(row.free),
      },
    });
  }
  // course
  return makeRecord({
    kind: 'course',
    title: row.title,
    link: row.link,
    source: row.provider || row.source || '',
    blurb: row.blurb || '',
    image: row.image || null,
    date: null,
    meta: {
      provider: row.provider || '',
      level: row.level || '',
      cert: truthy(row.cert),
    },
  });
}

module.exports = {
  makeRecord, normalizeArxiv, normalizeRemoteOK, normalizeWWR,
  normalizeDevpost, normalizeSheetRow,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/resource-normalize.test.js`
Expected: `resource-normalize.test OK`

- [ ] **Step 5: Commit**

```bash
git add src/lib/resource-normalize.js test/resource-normalize.test.js
git commit -m "feat: add Explore resource normalizers + unit test"
```

---

### Task 4: Resources store

The parallel in-memory store: fetch every source, normalize, merge-not-replace per kind, drop stale, sort, paginate. Mirrors `src/store.js` conventions but with no scoring/summaries/classify.

**Files:**
- Create: `src/resources.js`
- Test: `test/resources.test.js`

**Interfaces:**
- Consumes: `FEED_SOURCES`, `SHEET_TABS`, `KINDS`, `TAB_TO_KIND` (config); `fetchFeed` (feed.js); all normalizers (resource-normalize.js).
- Produces:
  - `getResources({ kind, page = 1, limit = 24, type = null })` → `{ items, page, hasMore, total, lastRefresh }`
  - `getCounts()` → `{ papers, jobs, events, courses, hackathons }`
  - `getSnapshot()` → `{ lastRefresh, byKind }`
  - `loadSnapshot(snapshot)` → `boolean`
  - `refresh()` → `Promise<void>`
  - `ensureReady()` → `Promise<{ ready, background }>`
  - `start()` → void (local interval mode)
  - `state` (exported for tests)

- [ ] **Step 1: Write the failing test**

```js
// test/resources.test.js — exercises pure store logic (pagination, counts,
// snapshot) by injecting records directly, no network.
const assert = require('assert');
const resources = require('../src/resources');

resources.state.byKind = {
  paper: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, kind: 'paper', title: `P${i}`, meta: {} })),
  job: [], hackathon: [], course: [],
  event: [
    { id: 'e1', kind: 'event', title: 'Conf', meta: { type: 'conference' } },
    { id: 'e2', kind: 'event', title: 'Shop', meta: { type: 'workshop' } },
  ],
};
resources.state.lastRefresh = new Date().toISOString();

const page1 = resources.getResources({ kind: 'paper', page: 1, limit: 24 });
assert.strictEqual(page1.items.length, 24);
assert.strictEqual(page1.hasMore, true);
assert.strictEqual(page1.total, 30);

const page2 = resources.getResources({ kind: 'paper', page: 2, limit: 24 });
assert.strictEqual(page2.items.length, 6);
assert.strictEqual(page2.hasMore, false);

// event type filter
const workshops = resources.getResources({ kind: 'event', type: 'workshop' });
assert.strictEqual(workshops.items.length, 1);
assert.strictEqual(workshops.items[0].id, 'e2');

// counts use plural tab names
const counts = resources.getCounts();
assert.strictEqual(counts.papers, 30);
assert.strictEqual(counts.events, 2);
assert.strictEqual(counts.jobs, 0);

// snapshot round-trips
const snap = resources.getSnapshot();
resources.state.byKind = { paper: [], job: [], event: [], course: [], hackathon: [] };
assert.strictEqual(resources.loadSnapshot(snap), true);
assert.strictEqual(resources.getCounts().papers, 30);

console.log('resources.test OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/resources.test.js`
Expected: FAIL — `Cannot find module '../src/resources'`

- [ ] **Step 3: Create `src/resources.js`**

```js
// In-memory Explore resources store. Parallel to src/store.js but stripped
// down: no scoring, no Claude summaries, no classification. Fetches live
// feeds + a public Google Sheet every refresh, merges (never replaces, so a
// timed-out source doesn't erase its cards), drops stale items, and serves
// paginated cards per kind.

const { FEED_SOURCES, SHEET_TABS, KINDS, TAB_TO_KIND } = require('./config/resource-sources');
const { fetchFeed } = require('./lib/feed');
const {
  normalizeArxiv, normalizeRemoteOK, normalizeWWR, normalizeDevpost, normalizeSheetRow,
} = require('./lib/resource-normalize');

const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS || 60 * 1000);
const JSON_TIMEOUT_MS = 7000;
const MAX_PER_KIND = 120;

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const state = {
  byKind: Object.fromEntries(KINDS.map((k) => [k, []])),
  lastRefresh: null,
  refreshing: false,
  sourceStatus: {},
};

function emptyByKind() {
  return Object.fromEntries(KINDS.map((k) => [k, []]));
}

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    headers: { 'user-agent': BROWSER_UA, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Google Sheet published via the gviz endpoint. Response is wrapped in
// `google.visualization.Query.setResponse(<json>);` — slice out the JSON.
async function fetchSheet(tab) {
  const id = process.env.EXPLORE_SHEET_ID;
  if (!id) return [];
  const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(JSON_TIMEOUT_MS), headers: { 'user-agent': BROWSER_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const cols = (json.table.cols || []).map((c) => String(c.label || '').toLowerCase().trim());
  return (json.table.rows || []).map((r) => {
    const obj = {};
    cols.forEach((label, i) => { if (label) obj[label] = r.c[i] ? (r.c[i].v ?? '') : ''; });
    return obj;
  });
}

function normalizeFeedItem(src, raw) {
  switch (src.id) {
    case 'remoteok': return normalizeRemoteOK(raw);
    case 'wwr': return normalizeWWR(raw);
    case 'devpost': return normalizeDevpost(raw);
    default: return src.kind === 'paper' ? normalizeArxiv(raw) : null;
  }
}

async function fetchFeedSource(src) {
  if (src.type === 'rss') {
    const feed = await fetchFeed(src.url);
    return (feed.items || []).map((raw) => normalizeFeedItem(src, raw));
  }
  // json
  const data = await fetchJson(src.url);
  let arr = src.arrayPath ? data[src.arrayPath] : data;
  if (!Array.isArray(arr)) arr = [];
  // RemoteOK's first array element is a legal notice, not a job.
  if (src.id === 'remoteok') arr = arr.filter((x) => x && x.position);
  return arr.map((raw) => normalizeFeedItem(src, raw));
}

function sortKind(kind, items) {
  if (kind === 'paper' || kind === 'job') {
    return items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }
  if (kind === 'event') {
    return items.sort((a, b) => new Date(a.date || '2999') - new Date(b.date || '2999'));
  }
  return items; // hackathon / course: keep source order
}

let refreshPromise = null;

function refresh() {
  if (state.refreshing) return refreshPromise;
  state.refreshing = true;
  refreshPromise = doRefresh().finally(() => { state.refreshing = false; refreshPromise = null; });
  return refreshPromise;
}

async function doRefresh() {
  const next = emptyByKind();

  const feedResults = await Promise.allSettled(FEED_SOURCES.map((src) => fetchFeedSource(src)));
  feedResults.forEach((result, i) => {
    const src = FEED_SOURCES[i];
    if (result.status === 'fulfilled') {
      const records = result.value.filter(Boolean);
      next[src.kind].push(...records);
      state.sourceStatus[src.id] = { ok: true, items: records.length, at: new Date().toISOString() };
    } else {
      state.sourceStatus[src.id] = { ok: false, error: result.reason && result.reason.message, at: new Date().toISOString() };
      console.warn(`[resources] ${src.id}: ${result.reason && result.reason.message}`);
    }
  });

  const sheetResults = await Promise.allSettled(SHEET_TABS.map((s) => fetchSheet(s.tab)));
  sheetResults.forEach((result, i) => {
    const { kind, tab } = SHEET_TABS[i];
    if (result.status === 'fulfilled') {
      const records = result.value.map((row) => normalizeSheetRow(row, kind)).filter(Boolean);
      next[kind].push(...records);
      state.sourceStatus[`sheet:${tab}`] = { ok: true, items: records.length, at: new Date().toISOString() };
    } else {
      state.sourceStatus[`sheet:${tab}`] = { ok: false, error: result.reason && result.reason.message, at: new Date().toISOString() };
      console.warn(`[resources] sheet:${tab}: ${result.reason && result.reason.message}`);
    }
  });

  // Merge-not-replace: a source that failed this round keeps its last cards.
  for (const kind of KINDS) {
    const seen = new Set(next[kind].map((r) => r.id));
    for (const prev of state.byKind[kind]) {
      if (!seen.has(prev.id)) { next[kind].push(prev); seen.add(prev.id); }
    }
    // Re-drop stale events (a previously-future event may now be past).
    let merged = next[kind];
    if (kind === 'event') {
      merged = merged.filter((r) => normalizeSheetRow(
        { title: r.title, link: r.link, type: r.meta.type, date: r.date, mode: r.meta.mode, city: r.meta.city, free: r.meta.free },
        'event',
      ));
    }
    state.byKind[kind] = sortKind(kind, merged).slice(0, MAX_PER_KIND);
  }

  state.lastRefresh = new Date().toISOString();
  const total = KINDS.reduce((n, k) => n + state.byKind[k].length, 0);
  console.log(`[resources] ${total} items across ${KINDS.length} kinds`);
}

function getResources({ kind, page = 1, limit = 24, type = null } = {}) {
  let items = state.byKind[kind] || [];
  if (kind === 'event' && type && type !== 'all') {
    items = items.filter((r) => r.meta.type === type);
  }
  const start = (page - 1) * limit;
  const slice = items.slice(start, start + limit);
  return { items: slice, page, hasMore: start + limit < items.length, total: items.length, lastRefresh: state.lastRefresh };
}

function getCounts() {
  const counts = {};
  for (const [tab, kind] of Object.entries(TAB_TO_KIND)) {
    counts[tab] = (state.byKind[kind] || []).length;
  }
  return counts;
}

function getSnapshot() {
  return { lastRefresh: state.lastRefresh, byKind: state.byKind };
}

function loadSnapshot(snapshot) {
  if (!snapshot || !snapshot.byKind) return false;
  state.byKind = emptyByKind();
  for (const kind of KINDS) state.byKind[kind] = snapshot.byKind[kind] || [];
  state.lastRefresh = snapshot.lastRefresh || new Date().toISOString();
  return true;
}

async function hydrateFromSnapshot() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (!host) return false;
  try {
    const res = await fetch(`https://${host}/api/explore?snapshot=1`, {
      signal: AbortSignal.timeout(2000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return false;
    return loadSnapshot(await res.json());
  } catch {
    return false;
  }
}

// Serverless: serve what's in hand, refresh in the background. `ready` is
// true once we've refreshed at least once (even if some kinds are empty —
// e.g. no sheet configured).
async function ensureReady() {
  const staleNow = () => !state.lastRefresh || Date.now() - new Date(state.lastRefresh).getTime() > REFRESH_INTERVAL_MS;

  if (!state.lastRefresh) await hydrateFromSnapshot();

  if (state.lastRefresh) {
    const background = staleNow() && !state.refreshing
      ? refresh().catch((err) => console.error('[resources] background refresh failed:', err.message))
      : null;
    return { ready: true, background };
  }

  const background = state.refreshing ? refreshPromise : refresh().catch((err) => console.error('[resources] warmup failed:', err.message));
  return { ready: false, background };
}

function start() {
  refresh().catch((err) => console.error('[resources] initial refresh failed:', err.message));
  setInterval(() => refresh().catch((err) => console.error('[resources] refresh failed:', err.message)), REFRESH_INTERVAL_MS);
}

module.exports = { start, ensureReady, refresh, getResources, getCounts, getSnapshot, loadSnapshot, state };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/resources.test.js`
Expected: `resources.test OK`

- [ ] **Step 5: Commit**

```bash
git add src/resources.js test/resources.test.js
git commit -m "feat: add Explore resources store"
```

---

### Task 5: API endpoint + local route + wiring

Serve resources over `/api/explore` in both serverless (Vercel function) and local (Express) modes, and start the resources store locally.

**Files:**
- Create: `api/explore.js`
- Modify: `server.js` (add route + `resources.start()`)

**Interfaces:**
- Consumes: `resources.getResources`, `resources.getCounts`, `resources.getSnapshot`, `resources.ensureReady`; `TAB_TO_KIND`; `waitUntil`, `cacheHeaders`, `warmingResponse` from `api/_shared.js`.
- Produces HTTP:
  - `GET /api/explore` → `{ counts, lastRefresh }`
  - `GET /api/explore?kind=papers&page=1&limit=24` → `{ items, page, hasMore, total, lastRefresh }`
  - `GET /api/explore?kind=events&type=workshop` → filtered events
  - `GET /api/explore?snapshot=1` → `{ lastRefresh, byKind }`

- [ ] **Step 1: Create `api/explore.js`**

```js
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

  cacheHeaders(res);
  res.json(resources.getResources({ kind, page, limit, type }));
};
```

- [ ] **Step 2: Wire the local Express route in `server.js`**

Add the require near the top (after `const store = require('./src/store');`):

```js
const resources = require('./src/resources');
```

Add this route alongside the other `app.get('/api/...')` routes (e.g. after the `/api/categories` route):

```js
// Explore resources: /api/explore, ?kind=papers&page=1, ?kind=events&type=workshop, ?snapshot=1
app.get('/api/explore', (req, res) => {
  const { TAB_TO_KIND } = require('./src/config/resource-sources');
  if (req.query.snapshot) return res.json(resources.getSnapshot());
  const kind = TAB_TO_KIND[req.query.kind];
  if (!kind) return res.json({ counts: resources.getCounts(), lastRefresh: resources.state.lastRefresh });
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 24));
  const type = req.query.type || null;
  res.json(resources.getResources({ kind, page, limit, type }));
});
```

Start the resources store in the `app.listen` callback, next to `store.start()`:

```js
app.listen(PORT, () => {
  console.log(`AI & Tech News running on http://localhost:${PORT}`);
  store.start();
  resources.start();
});
```

- [ ] **Step 3: Smoke-test locally**

Run: `npm start` (in a background terminal), then after ~10s:

Run: `curl -s "http://localhost:3000/api/explore" | head -c 300`
Expected: JSON with a `counts` object (e.g. `{"counts":{"papers":..,"jobs":..,...},"lastRefresh":"..."}`). `papers` should be > 0 (arXiv is reliable). `events`/`courses` may be 0 if `EXPLORE_SHEET_ID` is unset — that's fine.

Run: `curl -s "http://localhost:3000/api/explore?kind=papers&page=1&limit=3" | head -c 300`
Expected: `{"items":[{...paper...}],"page":1,...}`

Stop the server.

- [ ] **Step 4: Commit**

```bash
git add api/explore.js server.js
git commit -m "feat: serve Explore resources via /api/explore (serverless + local)"
```

---

### Task 6: Explore page shell

New standalone page reusing the site chrome (header, consent gate, notif prompt, toast, footer) and `styles.css`, plus a small block of Explore-specific CSS.

**Files:**
- Create: `public/explore.html`
- Modify: `public/styles.css` (append Explore tab/card styles)
- Modify: `public/index.html` (add "Explore" nav link in the header)

**Interfaces:**
- Produces: DOM ids consumed by `explore.js` in Task 7 — `#explore-tabs`, `#event-chips`, `#explore-grid`, `#explore-empty`, `#explore-more`, plus the shared `#theme-toggle`, `#toast`, `#toast-dest`, `#consent-gate`, `#consent-necessary`, `#consent-all`, `#notif-prompt`, `#notif-enable`, `#notif-dismiss`.

- [ ] **Step 1: Create `public/explore.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Explore — AI &amp; Tech News</title>
  <meta name="description" content="Explore AI & tech research papers, jobs, events, free courses, and hackathons — always up to date, linking to the source." />
  <link rel="canonical" href="https://ai-tech-news-alpha.vercel.app/explore.html" />
  <link rel="icon" type="image/png" href="logo.png" />
  <link rel="stylesheet" href="styles.css?v=11" />
  <link rel="preload" href="explore.js?v=11" as="script" />
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="/" aria-label="AI and Tech News home">
        <img class="brand-mark" src="logo.png" alt="" width="34" height="34" />
        <span class="brand-text">AI<em>&amp;</em>Tech News</span>
      </a>
      <nav class="top-nav" aria-label="Primary">
        <a href="/">Home</a>
        <a href="/explore.html" class="active" aria-current="page">Explore</a>
      </nav>
      <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">◐</button>
    </div>
  </header>

  <main class="wrap">
    <section id="explore" aria-label="Explore resources">
      <div class="explore-head">
        <h1 class="explore-title">Explore</h1>
        <p class="explore-sub">Papers, jobs, events, courses &amp; hackathons — always current, straight from the source.</p>
      </div>

      <div id="explore-tabs" class="explore-tabs" role="tablist" aria-label="Resource types"></div>
      <div id="event-chips" class="event-chips" hidden></div>

      <div id="explore-grid" class="feed-grid" aria-live="polite"></div>
      <div id="explore-empty" class="end-note" hidden>Nothing here right now — check back soon.</div>

      <div class="feed-actions">
        <button id="explore-more" class="btn-load-more" type="button" hidden>Load More</button>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <p class="muted"><a href="/">AI &amp; Tech News</a> · <a href="/privacy.html">Privacy Policy</a></p>
    </div>
  </footer>

  <div id="toast" class="toast" role="status" aria-live="polite" hidden>
    <span class="toast-icon">↗</span>
    <span>External link — you are leaving the platform.<br /><small id="toast-dest"></small></span>
  </div>

  <div id="consent-gate" class="consent-gate" role="dialog" aria-modal="true" aria-labelledby="consent-title" hidden>
    <div class="consent-card">
      <h2 id="consent-title">Cookie &amp; storage preferences</h2>
      <p>We use essential cookies and local storage to keep the site working. With your permission, we also use analytics cookies. Read our <a href="/privacy.html">Privacy Policy</a> for details.</p>
      <div class="consent-actions">
        <button id="consent-necessary" class="btn-consent btn-consent-secondary" type="button">Necessary Only</button>
        <button id="consent-all" class="btn-consent btn-consent-primary" type="button">Accept All Cookies</button>
      </div>
    </div>
  </div>

  <script src="explore.js?v=11"></script>
</body>
</html>
```

- [ ] **Step 2: Add the "Explore" nav link to `public/index.html`**

In `public/index.html`, the header currently has the brand `<a>`, the tagline `<p>`, then the theme toggle. Add a nav right after the brand link (before the tagline). Replace:

```html
      </a>
      <p class="tagline">Concise AI summaries · full stories at the source</p>
```

with:

```html
      </a>
      <nav class="top-nav" aria-label="Primary">
        <a href="/" class="active" aria-current="page">Home</a>
        <a href="/explore.html">Explore</a>
      </nav>
      <p class="tagline">Concise AI summaries · full stories at the source</p>
```

- [ ] **Step 3: Append Explore styles to `public/styles.css`**

Add at the end of the Header section (after the `.dev-credit` / `.theme-toggle` rules), or at the end of the file:

```css
/* ---------- Top nav + Explore ---------- */

.top-nav { display: flex; gap: 18px; }
.top-nav a {
  color: var(--ink-soft);
  text-decoration: none;
  font-weight: 700;
  font-size: 14px;
  padding: 4px 2px;
  border-bottom: 2px solid transparent;
  transition: color 0.18s ease, border-color 0.18s ease;
}
.top-nav a:hover { color: var(--ink); }
.top-nav a.active { color: var(--red); border-bottom-color: var(--red); }

.explore-head { margin: 26px 0 10px; }
.explore-title { margin: 0; font-size: clamp(26px, 3vw, 38px); font-weight: 900; letter-spacing: -0.015em; }
.explore-sub { margin: 6px 0 0; color: var(--ink-soft); font-size: 15px; }

.explore-tabs { display: flex; gap: 8px; overflow-x: auto; padding: 10px 0 14px; scrollbar-width: none; }
.explore-tabs::-webkit-scrollbar { display: none; }
.explore-tab {
  border: 1px solid var(--rule);
  background: var(--bg);
  color: var(--ink-soft);
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 13.5px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.18s ease;
}
.explore-tab:hover { border-color: var(--ink-faint); color: var(--ink); }
.explore-tab.active { background: var(--red); border-color: var(--red); color: #fff; }
.explore-tab .tab-count { opacity: 0.7; font-weight: 600; margin-left: 4px; }

.event-chips { display: flex; gap: 8px; flex-wrap: wrap; padding: 0 0 14px; }
.event-chip {
  border: 1px solid var(--rule);
  background: var(--bg);
  color: var(--ink-soft);
  border-radius: 999px;
  padding: 5px 13px;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}
.event-chip:hover { border-color: var(--ink-faint); color: var(--ink); }
.event-chip.active { background: var(--ink); border-color: var(--ink); color: var(--bg); }

.res-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.res-badge {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--chip-ink);
  background: var(--chip-bg);
  border-radius: 6px;
  padding: 3px 9px;
}
.res-badge.free { color: #0a7d33; background: rgba(10, 125, 51, 0.12); }
html[data-theme='dark'] .res-badge.free { color: #59d98a; background: rgba(89, 217, 138, 0.14); }
```

- [ ] **Step 4: Bump the news page asset version (cache-bust the shared CSS)**

In `public/index.html`, bump the stylesheet query from `styles.css?v=10` to `styles.css?v=11` so the new nav styles reach open tabs. (Leave `app.js?v=10` as-is; only CSS changed for the homepage.)

Change `<link rel="stylesheet" href="styles.css?v=10" />` → `<link rel="stylesheet" href="styles.css?v=11" />`.

- [ ] **Step 5: Verify pages load**

Run: `npm start` (background), then:

Run: `curl -s "http://localhost:3000/explore.html" | grep -c "explore-tabs"`
Expected: `1`

Open `http://localhost:3000/explore.html` in a browser — header shows Home / Explore, empty tab bar (populated in Task 7). Stop the server.

- [ ] **Step 6: Commit**

```bash
git add public/explore.html public/index.html public/styles.css
git commit -m "feat: add Explore page shell + top nav"
```

---

### Task 7: Explore frontend logic

Self-contained `explore.js`: theme, consent gate, external-link toast, tab bar, event chips, card grid, load-more. Deliberately duplicates a handful of tiny helpers from `app.js` (el, getJSON, showExternalNotice, theme, consent) rather than refactoring the working homepage — see the `ponytail:` note.

**Files:**
- Create: `public/explore.js`

**Interfaces:**
- Consumes: `/api/explore` endpoints (Task 5); DOM ids from `explore.html` (Task 6).
- Produces: none (leaf).

- [ ] **Step 1: Create `public/explore.js`**

```js
/* AI & Tech News — Explore page. Tabbed resource browser (papers, jobs,
   events, courses, hackathons) over /api/explore. Self-contained: repeats a
   few small helpers from app.js on purpose so the homepage stays untouched.
   ponytail: minor helper duplication with app.js; extract a common.js only
   if a third page appears. */

(() => {
  const TABS = [
    { key: 'papers', label: 'Papers' },
    { key: 'jobs', label: 'Jobs' },
    { key: 'events', label: 'Events' },
    { key: 'courses', label: 'Courses' },
    { key: 'hackathons', label: 'Hackathons' },
  ];
  const EVENT_TYPES = [
    { key: 'all', label: 'All' },
    { key: 'conference', label: 'Conferences' },
    { key: 'workshop', label: 'Workshops' },
    { key: 'session', label: 'Sessions' },
  ];

  const state = { tab: 'papers', eventType: 'all', page: 1, hasMore: false, loading: false };

  const $ = (id) => document.getElementById(id);
  const tabsEl = $('explore-tabs');
  const chipsEl = $('event-chips');
  const gridEl = $('explore-grid');
  const emptyEl = $('explore-empty');
  const moreBtn = $('explore-more');
  const toastEl = $('toast');
  const headerEl = document.querySelector('.site-header');

  /* ---------- Theme ---------- */
  if (localStorage.getItem('theme') === 'dark') document.documentElement.dataset.theme = 'dark';
  $('theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? '' : 'dark';
    localStorage.setItem('theme', dark ? 'light' : 'dark');
  });

  /* ---------- Consent gate (same contract as the homepage) ---------- */
  const CONSENT_KEY = 'cookie-consent';
  function initConsentGate() {
    if (localStorage.getItem(CONSENT_KEY)) return;
    const gate = $('consent-gate');
    document.body.style.overflow = 'hidden';
    gate.hidden = false;
    requestAnimationFrame(() => gate.classList.add('show'));
    const choose = (value) => {
      localStorage.setItem(CONSENT_KEY, value);
      gate.classList.remove('show');
      document.body.style.overflow = '';
      setTimeout(() => { gate.hidden = true; }, 250);
    };
    $('consent-necessary').addEventListener('click', () => choose('necessary'));
    $('consent-all').addEventListener('click', () => choose('all'));
  }
  initConsentGate();

  /* ---------- Header shadow on scroll ---------- */
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { headerEl.classList.toggle('scrolled', window.scrollY > 8); ticking = false; });
  }, { passive: true });

  /* ---------- Helpers ---------- */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  async function getJSON(url) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const res = await fetch(url);
      if (!res.ok && res.status !== 202) throw new Error(`${url} → ${res.status}`);
      const body = await res.json();
      if (!body.warming) return body;
      await new Promise((r) => setTimeout(r, 2500));
    }
    throw new Error('server did not warm up in time');
  }

  let toastTimer = null;
  function showExternalNotice(sourceName) {
    $('toast-dest').textContent = `Opening on ${sourceName || 'the source'}`;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => { toastEl.hidden = true; }, 250);
    }, 2600);
  }

  function openLink(item) {
    showExternalNotice(item.source);
    window.open(item.link, '_blank', 'noopener');
  }

  /* ---------- Card ---------- */
  function badgesFor(item) {
    const out = [];
    const m = item.meta || {};
    if (item.kind === 'paper' && m.authors) out.push({ text: m.authors });
    if (item.kind === 'job') {
      if (m.company) out.push({ text: m.company });
      if (m.location) out.push({ text: m.location });
    }
    if (item.kind === 'event') {
      if (m.type) out.push({ text: m.type.charAt(0).toUpperCase() + m.type.slice(1) });
      if (item.date) out.push({ text: new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) });
      if (m.city) out.push({ text: m.city });
      if (m.mode) out.push({ text: m.mode });
      if (m.free) out.push({ text: 'Free', free: true });
    }
    if (item.kind === 'course') {
      if (m.provider) out.push({ text: m.provider });
      if (m.level) out.push({ text: m.level });
      if (m.cert) out.push({ text: 'Certificate', free: true });
    }
    if (item.kind === 'hackathon') {
      if (m.deadline) out.push({ text: m.deadline });
      if (m.mode) out.push({ text: m.mode });
      if (m.prize) out.push({ text: m.prize });
    }
    return out;
  }

  function resourceCard(item, i) {
    const card = el('article', 'news-card');
    card.style.setProperty('--i', Math.min(i, 11));

    const info = el('div', 'card-info');
    const title = el('h3', 'card-title');
    const link = el('a', null, item.title);
    link.href = item.link;
    link.target = '_blank';
    link.rel = 'noopener external';
    link.addEventListener('click', (e) => { e.preventDefault(); openLink(item); });
    title.append(link);
    info.append(title);

    if (item.source) {
      const meta = el('div', 'meta-row');
      meta.append(el('span', 'source-name', item.source));
      info.append(meta);
    }
    if (item.blurb) info.append(el('p', 'card-blurb', item.blurb));

    const badges = badgesFor(item);
    if (badges.length) {
      const row = el('div', 'res-badges');
      for (const b of badges) row.append(el('span', `res-badge${b.free ? ' free' : ''}`, b.text));
      info.append(row);
    }

    card.append(info);
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    card.setAttribute('aria-label', `${item.title} — open on ${item.source || 'source'}`);
    card.addEventListener('click', (e) => { if (!e.target.closest('a')) openLink(item); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === card) openLink(item); });
    return card;
  }

  /* ---------- Tabs + chips ---------- */
  function renderTabs(counts) {
    tabsEl.textContent = '';
    for (const { key, label } of TABS) {
      const btn = el('button', 'explore-tab', label);
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      if (key === state.tab) btn.classList.add('active');
      const n = counts && counts[key];
      if (n) btn.append(el('span', 'tab-count', String(n)));
      btn.addEventListener('click', () => { if (state.tab !== key) selectTab(key); });
      tabsEl.append(btn);
    }
  }

  function renderChips() {
    chipsEl.textContent = '';
    chipsEl.hidden = state.tab !== 'events';
    if (state.tab !== 'events') return;
    for (const { key, label } of EVENT_TYPES) {
      const chip = el('button', 'event-chip', label);
      chip.type = 'button';
      if (key === state.eventType) chip.classList.add('active');
      chip.addEventListener('click', () => {
        if (state.eventType === key) return;
        state.eventType = key;
        renderChips();
        loadFirstPage();
      });
      chipsEl.append(chip);
    }
  }

  function tabParams(page) {
    const params = new URLSearchParams({ kind: state.tab, page, limit: 24 });
    if (state.tab === 'events' && state.eventType !== 'all') params.set('type', state.eventType);
    return params;
  }

  function selectTab(key) {
    state.tab = key;
    state.eventType = 'all';
    tabsEl.querySelectorAll('.explore-tab').forEach((b) => b.classList.remove('active'));
    [...tabsEl.querySelectorAll('.explore-tab')][TABS.findIndex((t) => t.key === key)]?.classList.add('active');
    history.replaceState(null, '', `?kind=${key}`);
    renderChips();
    loadFirstPage();
  }

  async function loadFirstPage() {
    state.page = 1;
    gridEl.textContent = '';
    emptyEl.hidden = true;
    moreBtn.hidden = true;
    try {
      const data = await getJSON(`/api/explore?${tabParams(1)}`);
      const frag = document.createDocumentFragment();
      data.items.forEach((item, i) => frag.append(resourceCard(item, i)));
      gridEl.append(frag);
      state.hasMore = data.hasMore;
      state.page = 2;
      moreBtn.hidden = !data.hasMore;
      emptyEl.hidden = data.items.length > 0;
    } catch (err) {
      console.error('explore load failed', err);
      emptyEl.hidden = false;
    }
  }

  async function loadMore() {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    moreBtn.disabled = true;
    moreBtn.textContent = 'Loading…';
    try {
      const data = await getJSON(`/api/explore?${tabParams(state.page)}`);
      const frag = document.createDocumentFragment();
      data.items.forEach((item, i) => frag.append(resourceCard(item, i)));
      gridEl.append(frag);
      state.hasMore = data.hasMore;
      state.page += 1;
      moreBtn.hidden = !data.hasMore;
    } catch (err) {
      console.error('explore load-more failed', err);
    } finally {
      state.loading = false;
      moreBtn.disabled = false;
      moreBtn.textContent = 'Load More';
    }
  }
  moreBtn.addEventListener('click', loadMore);

  /* ---------- Boot ---------- */
  async function boot() {
    const wanted = new URLSearchParams(location.search).get('kind');
    if (TABS.some((t) => t.key === wanted)) state.tab = wanted;
    renderTabs(null);
    renderChips();
    loadFirstPage();
    try {
      const meta = await getJSON('/api/explore');
      renderTabs(meta.counts);
    } catch { /* counts are cosmetic — ignore */ }
  }
  boot();
})();
```

- [ ] **Step 2: Add a `.card-blurb` style to `public/styles.css`**

Resource cards use a text blurb where news cards use an image overlay. Append near the Explore styles from Task 6:

```css
.card-blurb { margin: 8px 0 0; color: var(--ink-soft); font-size: 13.5px; line-height: 1.5; }
```

- [ ] **Step 3: Manual verification**

Run: `npm start` (background). Open `http://localhost:3000/explore.html`:
- Tab bar shows Papers / Jobs / Events / Courses / Hackathons with counts.
- Papers tab lists arXiv papers; each card links out and fires the toast on click.
- Events tab reveals the type chips (All / Conferences / Workshops / Sessions).
- Load More appends a page when `hasMore`.
- Dark-mode toggle works; consent gate appears on a fresh browser profile.

Run: `curl -s "http://localhost:3000/api/explore?kind=papers&limit=2"` and confirm real items.
Stop the server.

- [ ] **Step 4: Commit**

```bash
git add public/explore.js public/styles.css
git commit -m "feat: Explore frontend — tabs, event chips, resource cards"
```

---

### Task 8: Google Sheet setup doc + README note

Document the one manual setup step (the Sheet) so events/courses populate. No code — a short doc so the feature is operable.

**Files:**
- Create: `docs/explore-google-sheet.md`
- Modify: `CLAUDE.md` (add `EXPLORE_SHEET_ID` to the env table + a one-line Explore note)

**Interfaces:** none (docs only).

- [ ] **Step 1: Create `docs/explore-google-sheet.md`**

```markdown
# Explore — Google Sheet setup (events & courses)

The Explore page's **Events** and **Courses** tabs are populated from a public
Google Sheet, refetched every refresh cycle. Edit a row → it's live on the site
within ~1 minute. No API key, no redeploy.

## One-time setup

1. Create a Google Sheet with **two tabs** named exactly `events` and `courses`.
2. **Share** it: *Anyone with the link → Viewer*.
3. Copy the spreadsheet id from the URL:
   `https://docs.google.com/spreadsheets/d/<THIS_IS_THE_ID>/edit`
4. Set it as an env var:
   - Local: `EXPLORE_SHEET_ID=<id>` in your shell / `.env`.
   - Vercel: Project → Settings → Environment Variables → `EXPLORE_SHEET_ID`.

If `EXPLORE_SHEET_ID` is unset, Events and Courses are simply empty — every
other tab (Papers, Jobs, Hackathons) still works.

## Column headers

Header row is case-insensitive; extra columns are ignored; only `title` + `link`
are required.

**`events` tab:** `title`, `link`, `type` (conference | workshop | session),
`date` (YYYY-MM-DD — past-dated rows are auto-hidden), `mode` (online |
in-person), `city`, `free` (yes/no), `source`, `blurb`, `image`.

**`courses` tab:** `title`, `link`, `provider`, `level` (Beginner/…),
`cert` (yes/no), `blurb`, `image`.
```

- [ ] **Step 2: Update `CLAUDE.md`**

In the **Environment variables** block, add:

```
EXPLORE_SHEET_ID      optional — Google Sheet id for Explore events/courses (see docs/explore-google-sheet.md)
```

And add one line under Architecture (near the `api/` list):

```
  explore.js            Explore resources: papers/jobs/events/courses/hackathons (src/resources.js)
```

- [ ] **Step 3: Commit**

```bash
git add docs/explore-google-sheet.md CLAUDE.md
git commit -m "docs: Explore Google Sheet setup + env var"
```

---

## Self-Review

**Spec coverage:**
- Papers/Jobs/Hackathons live feeds → Tasks 2–4. ✓
- Events/Courses via Google Sheet → Tasks 3 (normalizer), 4 (fetchSheet), 8 (setup). ✓
- Auto-update (live sources, background refresh) → Task 4 `refresh`/`start`/`ensureReady`. ✓
- News store untouched → Task 1 refactor is behavior-preserving; resources are a separate module. ✓
- Compliance (blurb ≤ 40 words, link-out, toast) → `makeRecord` cap + `openLink`/`showExternalNotice`. ✓
- Explore tabbed UI + Events chips → Tasks 6–7. ✓
- Never block request path → Task 5 `ensureReady` + `waitUntil`, cache headers. ✓
- Cold-start hydrate → Task 4 `hydrateFromSnapshot` + `?snapshot=1`. ✓
- Graceful empty (no sheet) → `fetchSheet` returns `[]`; empty tab note. ✓

**Placeholder scan:** none — every step has full code or exact edits.

**Type consistency:** record shape `{id,kind,title,link,source,blurb,image,date,meta}` identical across normalizers, store, API, and frontend `badgesFor`. `TAB_TO_KIND` keys (`papers/jobs/events/courses/hackathons`) match `TABS` keys in `explore.js` and `getCounts()` output. `getResources`/`getCounts`/`getSnapshot`/`ensureReady` signatures match their call sites in `api/explore.js` and `server.js`.

## Out of scope (later phases, not in this plan)

Save-for-later & Follow-topics (localStorage), Weekly digest, Launches (Product Hunt/GitHub), Talks/podcasts (YouTube RSS), HN "who's hiring", confs.tech.
