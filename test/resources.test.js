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
