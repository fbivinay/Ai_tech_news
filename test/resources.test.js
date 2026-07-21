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

// job field filter
resources.state.byKind.job = [
  { id: 'j1', kind: 'job', title: 'ML Engineer', meta: { field: 'ai' } },
  { id: 'j2', kind: 'job', title: 'Backend Dev', meta: { field: 'engineering' } },
];
const aiJobs = resources.getResources({ kind: 'job', type: 'ai' });
assert.strictEqual(aiJobs.items.length, 1);
assert.strictEqual(aiJobs.items[0].id, 'j1');
resources.state.byKind.job = [];

// mergeKind tags job field on merged records (incl. snapshot-hydrated ones)
const taggedJobs = resources.mergeKind('job', [], [
  { id: 'j3', kind: 'job', title: 'Data Analyst', link: 'https://x.com/j3', date: '2026-07-01', meta: { location: 'Bengaluru', mode: '' } },
]);
assert.strictEqual(taggedJobs[0].meta.field, 'data');

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

// --- mergeKind: merge-not-replace invariant (no network) ---

// MERGE PRESERVE: a source that returns nothing this round keeps prior cards.
const preserved = resources.mergeKind('paper', [], [
  { id: 'a', kind: 'paper', title: 'A', meta: {} },
]);
assert.strictEqual(preserved.length, 1);
assert.strictEqual(preserved[0].id, 'a');

// NO DUPLICATE: same id in both incoming and previous → one record, and
// incoming wins (current dedupe seeds `next[kind]` first, so previous items
// with an id already present in incoming are skipped).
const deduped = resources.mergeKind('paper', [
  { id: 'a', kind: 'paper', title: 'A (new)', meta: {} },
], [
  { id: 'a', kind: 'paper', title: 'A (old)', meta: {} },
]);
assert.strictEqual(deduped.length, 1);
assert.strictEqual(deduped[0].title, 'A (new)');

// STALE EVENT REDROP: a previously-future event that's now past gets dropped
// on re-merge; a still-future event survives.
const events = resources.mergeKind('event', [], [
  {
    id: 'e1', kind: 'event', title: 'Old', link: 'https://x.com/e1', date: '2000-01-01', meta: { type: 'conference' },
  },
]);
assert.strictEqual(events.length, 0);

const futureEvents = resources.mergeKind('event', [], [
  {
    id: 'e2', kind: 'event', title: 'New', link: 'https://x.com/e2', date: '2099-01-01', meta: { type: 'conference' },
  },
]);
assert.strictEqual(futureEvents.length, 1);
assert.strictEqual(futureEvents[0].id, 'e2');

console.log('resources.test OK');
