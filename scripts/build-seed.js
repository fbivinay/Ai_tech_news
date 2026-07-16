// Builds data/seed.json — a news snapshot bundled with the deployment so
// even the very first request after a deploy answers instantly (the live
// background refresh replaces it within seconds).
//
// Run before deploying if you want a fresher bootstrap: npm run build:seed

const fs = require('fs');
const path = require('path');
const store = require('../src/store');

(async () => {
  console.log('Fetching all feeds once to build the seed snapshot…');
  await store.refresh({ maxSummaryBatches: 0 });
  const snapshot = store.getSnapshot();
  if (!snapshot.items.length) {
    console.error('No items fetched — seed not written.');
    process.exit(1);
  }
  const outPath = path.join(__dirname, '..', 'data', 'seed.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot));
  console.log(`Wrote ${snapshot.items.length} items to data/seed.json (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
  process.exit(0);
})().catch((err) => {
  console.error('Seed build failed:', err);
  process.exit(1);
});
