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
