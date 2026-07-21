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

function normalizeRemotive(j) {
  if (!j || !j.title) return null;
  return makeRecord({
    kind: 'job',
    title: j.title,
    link: j.url,
    source: 'Remotive',
    image: j.company_logo || null,
    date: j.publication_date || null,
    meta: {
      company: j.company_name || '',
      location: j.candidate_required_location || '',
      mode: 'Remote',
      salary: stripHtml(j.salary || '').slice(0, 40) || salFromText(j.description || ''),
      type: String(j.job_type || '').replace(/_/g, ' '),
      experience: expFromText(j.description || ''),
    },
  });
}

// India, by name or by tech-hub city (ATS boards often write just "Bengaluru").
const INDIA_RE = /india|bengaluru|bangalore|mumbai|hyderabad|pune|chennai|delhi|noida|gurgaon|gurugram|kochi|ahmedabad|kolkata|jaipur|indore/i;

// India focus: a job qualifies if it names India (or an Indian city), or is
// remote and open to India (worldwide/anywhere/global/APAC/Asia).
// Region-locked remote roles (US-only, EMEA…) and other countries drop.
function isIndiaEligibleJob(record) {
  const loc = (record.meta && record.meta.location) || '';
  if (INDIA_RE.test(`${loc} ${record.title}`)) return true;
  if (record.meta && record.meta.mode === 'Remote' && /worldwide|anywhere|global|apac|asia/i.test(loc)) return true;
  return false;
}

// Career boards list every department — keep only AI/tech roles.
const TECH_TITLE_RE = /engineer|developer|data|machine.?learning|\bml\b|\bai\b|scientist|analyst|devops|sre|architect|security|product|design|qa\b|sdet|platform|cloud|backend|frontend|full.?stack|mobile|android|ios\b|research|software|technical|technolog|infra/i;

// AI/tech topic for courses, events, hackathons — first match wins.
// Returns '' when nothing tech-related matches (used to drop off-topic
// records from general catalogs like Coursera's).
function classifyTopic(text) {
  const t = String(text || '');
  const rules = [
    ['MCP', /\bmcp\b|model context protocol/i],
    ['RAG', /\brag\b|retrieval.?augmented/i],
    ['AI Agents', /agent(?:ic|s)?\b/i],
    ['Prompt Engineering', /prompt/i],
    ['LLMs', /\bllms?\b|large language|gpt|claude|gemini|llama|transformer/i],
    ['Generative AI', /gen(?:erative)?.?ai|diffusion|text.?to.?image/i],
    ['Computer Vision', /computer vision|image recognition|opencv|object detection/i],
    ['NLP', /\bnlp\b|natural language|text mining|speech/i],
    ['Deep Learning', /deep learning|neural network|pytorch|tensorflow|keras/i],
    ['MLOps', /mlops|model deployment|model serving/i],
    ['Machine Learning', /machine.?learning|\bml\b|scikit|xgboost|supervised|classification model/i],
    ['Data Science', /data scien|analytics|data analy|statistics|pandas|\bbi\b|power bi|tableau|data engineer|big data|spark|kafka/i],
    ['SQL', /\bsql\b|database|postgres|mysql/i],
    ['Python', /python|django|flask/i],
    ['Cybersecurity', /security|cyber|hacking|pentest|cryptograph/i],
    ['Cloud', /cloud|aws|azure|gcp|kubernetes|docker|serverless/i],
    ['DevOps', /devops|\bsre\b|ci\/cd|terraform|ansible/i],
    ['AI', /\bai\b|artificial intelligence|intelligent/i],
    ['Robotics', /robot/i],
    ['Web Dev', /javascript|typescript|react|node|web dev|frontend|backend|full.?stack|html|css/i],
    ['Tech', /software|programming|coding|computer|developer|engineering|linux|git|api\b|data\b/i],
  ];
  for (const [label, re] of rules) if (re.test(t)) return label;
  return '';
}

// Job field from the title — first match wins, engineering is the catch-all.
function classifyJobField(title) {
  const t = String(title || '');
  if (/machine.?learning|\bml\b|\bai\b|deep.?learning|\bllm\b|gen.?ai|\bnlp\b|computer.?vision|prompt.?engineer|research.?(scientist|engineer)|robotics/i.test(t)) return 'ai';
  if (/\bdata\b|analytics|analyst|\betl\b|\bbi\b|database|warehouse/i.test(t)) return 'data';
  if (/security|appsec|infosec|offensive|threat/i.test(t)) return 'security';
  if (/product|design|\bux\b|\bui\b/i.test(t)) return 'product';
  if (/devops|\bsre\b|reliability|cloud|infra|platform/i.test(t)) return 'devops';
  return 'engineering';
}

// "3+ yrs exp" / "2–5 yrs exp" pulled from a description; '' when absent.
// Only this tiny fact is extracted — the description itself is discarded.
function expFromText(text) {
  const m = String(text || '').match(/(\d{1,2})\s*(?:(?:-|–|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)/i);
  if (!m || Number(m[1]) > 15) return '';
  return m[2] ? `${m[1]}–${m[2]} yrs exp` : `${m[1]}+ yrs exp`;
}

// Salary range from description text — Indian (₹/INR/LPA/lakh) and USD forms.
// Returns '' unless an actual range is stated; never invents figures.
function salFromText(text) {
  const t = String(text || '');
  let m = t.match(/(?:₹|\binr\b|\brs\.?)\s*([\d,]+(?:\.\d+)?)\s*(?:-|–|to)\s*(?:₹|\binr\b|\brs\.?)?\s*([\d,]+(?:\.\d+)?)\s*(lpa|lakhs?|\bl\b|cr)?/i);
  if (m) return `₹${m[1]}–₹${m[2]}${m[3] ? ` ${m[3].toUpperCase()}` : ''}`;
  m = t.match(/(\d{1,3}(?:\.\d+)?)\s*(?:-|–|to)\s*(\d{1,3}(?:\.\d+)?)\s*(?:lpa|lakhs?)/i);
  if (m) return `₹${m[1]}–${m[2]} LPA`;
  m = t.match(/\$\s*([\d,]{2,7})\s*(k)?\s*(?:-|–|to)\s*\$?\s*([\d,]{2,7})\s*(k)?/);
  if (m) return `$${m[1]}${m[2] || m[4] ? 'k' : ''}–$${m[3]}${m[2] || m[4] ? 'k' : ''}`;
  return '';
}

// Company logo via the same favicon service the news cards already use.
function faviconLogo(domain) {
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : null;
}

// --- ATS normalizers (src carries { company, domain } from config) ---

function normalizeGreenhouse(j, src) {
  if (!j || !j.title) return null;
  return makeRecord({
    kind: 'job',
    title: j.title,
    link: j.absolute_url,
    source: src.company,
    image: faviconLogo(src.domain),
    date: j.updated_at || j.first_published || null,
    meta: {
      company: src.company,
      location: (j.location && j.location.name) || '',
      mode: '',
      salary: '',
      type: '',
      experience: '',
      // Enrichment pass fetches this job's detail (description text) once
      // to fill salary/experience — see enrichJobs() in src/resources.js.
      ghSlug: src.slug,
      ghId: j.id,
    },
  });
}

function normalizeLever(j, src) {
  if (!j || !j.text) return null;
  const wp = String(j.workplaceType || '').toLowerCase();
  return makeRecord({
    kind: 'job',
    title: j.text,
    link: j.hostedUrl,
    source: src.company,
    image: faviconLogo(src.domain),
    date: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    meta: {
      company: src.company,
      location: (j.categories && j.categories.location) || '',
      mode: wp === 'remote' ? 'Remote' : wp === 'hybrid' ? 'Hybrid' : wp ? 'On-site' : '',
      salary: (j.salaryRange ? fmtSalary(j.salaryRange.min, j.salaryRange.max, j.salaryRange.currency) : '') || salFromText(j.descriptionPlain || ''),
      type: (j.categories && j.categories.commitment) || '',
      experience: expFromText(j.descriptionPlain || ''),
    },
  });
}

function normalizeAshby(j, src) {
  if (!j || !j.title) return null;
  return makeRecord({
    kind: 'job',
    title: j.title,
    link: j.jobUrl || j.applyUrl,
    source: src.company,
    image: faviconLogo(src.domain),
    date: j.publishedAt || null,
    meta: {
      company: src.company,
      location: [j.location, ...(j.secondaryLocations || []).map((x) => x.location)].filter(Boolean).join(', '),
      mode: j.isRemote ? 'Remote' : '',
      salary: (j.compensation && j.compensation.compensationTierSummary) || salFromText(j.descriptionHtml || ''),
      type: j.employmentType || '',
      experience: expFromText(j.descriptionHtml || ''),
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
      salary: salFromText(j.contents || ''),
      type: '',
      experience: expFromText(j.contents || ''),
    },
  });
}

// Microsoft Learn catalog — keyless, free, has images + a real popularity
// score. Everything on it is tech; category still computed for the chips.
function normalizeMsLearn(j) {
  if (!j || !j.title || !j.url) return null;
  return makeRecord({
    kind: 'course',
    title: j.title,
    link: j.url,
    source: 'Microsoft Learn',
    image: j.social_image_url || j.icon_url || null,
    date: j.last_modified || null,
    meta: {
      provider: 'Microsoft Learn',
      level: (j.levels && j.levels[0]) || '',
      cert: false,
      free: true,
      category: classifyTopic(`${j.title} ${(j.products || []).join(' ')} ${(j.subjects || []).join(' ')}`) || 'Tech',
      popularity: j.popularity || 0,
      duration: j.duration_in_minutes ? `${Math.round(j.duration_in_minutes / 60)}h` : '',
    },
  });
}

// Coursera public catalog — unfiltered general catalog, so records that
// don't classify as an AI/tech topic are dropped.
function normalizeCoursera(j) {
  if (!j || !j.name || !j.slug) return null;
  const category = classifyTopic(j.name);
  if (!category) return null;
  return makeRecord({
    kind: 'course',
    title: j.name,
    link: `https://www.coursera.org/learn/${j.slug}`,
    source: 'Coursera',
    image: j.photoUrl || null,
    date: null,
    meta: { provider: 'Coursera', level: '', cert: true, free: false, category, popularity: 0, duration: '' },
  });
}

// confs.tech community conference data (per-topic JSON, live repo).
function normalizeConfsTech(c) {
  if (!c || !c.name || !c.url) return null;
  const past = c.endDate || c.startDate;
  if (past && new Date(past) < new Date(new Date().toDateString())) return null;
  return makeRecord({
    kind: 'event',
    title: c.name,
    link: c.url,
    source: 'confs.tech',
    date: c.startDate || null,
    meta: {
      type: 'conference',
      mode: c.online ? 'online' : 'in-person',
      city: [c.city, c.country].filter(Boolean).join(', '),
      free: false,
      category: classifyTopic(c.name) || 'Tech',
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
  normalizeRemotive, isIndiaEligibleJob, INDIA_RE, TECH_TITLE_RE, expFromText, salFromText, classifyJobField,
  normalizeGreenhouse, normalizeLever, normalizeAshby,
  normalizeMsLearn, normalizeCoursera, normalizeConfsTech, classifyTopic,
  normalizeDevpost, normalizeSheetRow,
};
