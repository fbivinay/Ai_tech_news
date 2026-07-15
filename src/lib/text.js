// Text utilities: HTML stripping, sentence splitting, word-bounded truncation.

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&#8217;': '’', '&#8216;': '‘', '&#8220;': '“', '&#8221;': '”',
  '&#8230;': '…', '&hellip;': '…', '&nbsp;': ' ', '&#160;': ' ',
  '&mdash;': '—', '&#8212;': '—', '&ndash;': '–', '&#8211;': '–',
};

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return ''; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ''; }
    })
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m] ?? ' ');
}

function stripHtml(html) {
  if (!html) return '';
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text) {
  // Simple sentence splitter — good enough for feed excerpts.
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function wordCount(text) {
  return text ? text.trim().split(/\s+/).length : 0;
}

function truncateWords(text, maxWords) {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(' ').replace(/[,;:]$/, '') + '…';
}

module.exports = { stripHtml, splitSentences, wordCount, truncateWords };
