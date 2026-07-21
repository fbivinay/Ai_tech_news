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

// "$60k–$90k" from raw annual figures; empty string when unknown.
function fmtSalary(min, max, currency) {
  if (!min && !max) return '';
  const sym = { USD: '$', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$', INR: '₹' }[currency] || '$';
  const k = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  if (min && max && min !== max) return `${sym}${k(min)}–${sym}${k(max)}`;
  return `${sym}${k(min || max)}`;
}

// Job meta contract (all sources): { company, location, mode, salary, type }
// mode: 'Remote' | 'On-site' | 'Hybrid' | '' — shown as a card badge.

function normalizeRemoteOK(job) {
  if (!job || !job.position) return null;
  return makeRecord({
    kind: 'job',
    title: job.position,
    link: job.url || job.apply_url,
    source: 'RemoteOK',
    image: job.company_logo || job.logo || null,
    date: job.date || null,
    meta: {
      company: job.company || '',
      location: job.location || '',
      mode: 'Remote',
      salary: fmtSalary(job.salary_min, job.salary_max, 'USD'),
      type: '',
    },
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
    date: entry.isoDate || entry.pubDate || null,
    meta: { company, location: '', mode: 'Remote', salary: '', type: '' },
  });
}

function normalizeArbeitnow(j) {
  if (!j || !j.title) return null;
  return makeRecord({
    kind: 'job',
    title: j.title,
    link: j.url,
    source: 'Arbeitnow',
    date: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
    meta: {
      company: j.company_name || '',
      location: j.location || '',
      mode: j.remote ? 'Remote' : 'On-site',
      salary: '',
      type: Array.isArray(j.job_types) && j.job_types[0] ? j.job_types[0] : '',
    },
  });
}

function normalizeJobicy(j) {
  if (!j || !j.jobTitle) return null;
  return makeRecord({
    kind: 'job',
    title: j.jobTitle,
    link: j.url,
    source: 'Jobicy',
    image: j.companyLogo || null,
    date: j.pubDate ? new Date(String(j.pubDate).replace(' ', 'T')).toISOString() : null,
    meta: {
      company: j.companyName || '',
      location: j.jobGeo || '',
      mode: 'Remote',
      salary: fmtSalary(j.annualSalaryMin, j.annualSalaryMax, j.salaryCurrency),
      type: Array.isArray(j.jobType) ? (j.jobType[0] || '') : (j.jobType || ''),
    },
  });
}

function normalizeHimalayas(j) {
  if (!j || !j.title) return null;
  const ts = j.pubDate ? (j.pubDate > 1e12 ? j.pubDate : j.pubDate * 1000) : null;
  return makeRecord({
    kind: 'job',
    title: j.title,
    link: j.applicationLink || j.guid,
    source: 'Himalayas',
    image: j.companyLogo || null,
    date: ts ? new Date(ts).toISOString() : null,
    meta: {
      company: j.companyName || '',
      location: (Array.isArray(j.locationRestrictions) ? j.locationRestrictions.slice(0, 2).join(', ') : '') || '',
      mode: 'Remote',
      salary: fmtSalary(j.minSalary, j.maxSalary, j.salaryCurrency || 'USD'),
      type: j.employmentType || '',
    },
  });
}

function normalizeMuse(j) {
  if (!j || !j.name) return null;
  const location = (j.locations && j.locations[0] && j.locations[0].name) || '';
  return makeRecord({
    kind: 'job',
    title: j.name,
    link: j.refs && j.refs.landing_page,
    source: 'The Muse',
    date: j.publication_date || null,
    meta: {
      company: (j.company && j.company.name) || '',
      location,
      mode: /remote|flexible/i.test(location) ? 'Remote' : '',
      salary: '',
      type: '',
    },
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
  normalizeArbeitnow, normalizeJobicy, normalizeHimalayas, normalizeMuse,
  normalizeDevpost, normalizeSheetRow,
};
