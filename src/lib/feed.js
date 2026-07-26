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
      ['media:group', 'mediaGroup'],
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
