// test/resources.test.js — exercises pure store logic (pagination, counts,
// snapshot) by injecting records directly, no network.
const assert = require('assert');
const resources = require('../src/resources');

resources.state.byKind = {
  paper: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, kind: 'paper', title: `P${i}`, meta: {} })),
  job: [], hackathon: [], course: [],
};
resources.state.lastRefresh = new Date().toISOString();

const page1 = resources.getResources({ kind: 'paper', page: 1, limit: 24 });
assert.strictEqual(page1.items.length, 24);
assert.strictEqual(page1.hasMore, true);
assert.strictEqual(page1.total, 30);

const page2 = resources.getResources({ kind: 'paper', page: 2, limit: 24 });
assert.strictEqual(page2.items.length, 6);
assert.strictEqual(page2.hasMore, false);

// job field filter
resources.state.byKind.job = [
  { id: 'j1', kind: 'job', title: 'ML Engineer', meta: { field: 'ai' } },
  { id: 'j2', kind: 'job', title: 'Backend Dev', meta: { field: 'engineering' } },
];
const aiJobs = resources.getResources({ kind: 'job', type: 'ai' });
assert.strictEqual(aiJobs.items.length, 1);
assert.strictEqual(aiJobs.items[0].id, 'j1');
resources.state.byKind.job = [];

// search + jobs filters (q / mode / city / exp)
resources.state.byKind.job = [
  { id: 'q1', kind: 'job', title: 'React Developer', source: 'X', blurb: '', meta: { company: 'Acme', location: 'Bengaluru', mode: 'Hybrid', experience: '2+ yrs exp', field: 'engineering' } },
  { id: 'q2', kind: 'job', title: 'ML Engineer', source: 'X', blurb: '', meta: { company: 'Beta', location: 'Bangalore, India', mode: 'Remote', experience: '6+ yrs exp', field: 'ai' } },
  { id: 'q3', kind: 'job', title: 'Data Analyst', source: 'X', blurb: '', meta: { company: 'Gamma', location: 'Mumbai', mode: 'On-site', experience: '', field: 'data' } },
];
assert.strictEqual(resources.getResources({ kind: 'job', q: 'react' }).items.length, 1);
assert.strictEqual(resources.getResources({ kind: 'job', q: 'gamma' }).items.length, 1); // company matches too
assert.strictEqual(resources.getResources({ kind: 'job', mode: 'remote' }).items.length, 1);
assert.strictEqual(resources.getResources({ kind: 'job', city: 'bengaluru' }).items.length, 2); // both spellings
assert.strictEqual(resources.getResources({ kind: 'job', exp: '0-2' }).items.length, 1);
assert.strictEqual(resources.getResources({ kind: 'job', exp: '6+' }).items.length, 1);
resources.state.byKind.job = [];

// mergeKind tags job field on merged records (incl. snapshot-hydrated ones)
const taggedJobs = resources.mergeKind('job', [], [
  { id: 'j3', kind: 'job', title: 'Data Analyst', link: 'https://x.com/j3', date: '2026-07-01', meta: { location: 'Bengaluru', mode: '' } },
]);
assert.strictEqual(taggedJobs[0].meta.field, 'data');

// counts use plural tab names
const counts = resources.getCounts();
assert.strictEqual(counts.papers, 30);
assert.strictEqual(counts.jobs, 0);

// snapshot round-trips
const snap = resources.getSnapshot();
resources.state.byKind = { paper: [], job: [], course: [], hackathon: [] };
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

console.log('resources.test OK');
