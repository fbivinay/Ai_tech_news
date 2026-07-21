// Live sources for the Explore resources store. Feed sources are fetched
// every refresh cycle; sheet tabs are pulled from the public Google Sheet
// (EXPLORE_SHEET_ID). Everything here auto-updates — nothing is bundled.

const ARXIV_CATEGORIES = ['cs.AI', 'cs.LG', 'cs.CL'];

const FEED_SOURCES = [
  ...ARXIV_CATEGORIES.map((cat) => ({
    id: `arxiv-${cat}`,
    kind: 'paper',
    type: 'rss',
    url: `https://export.arxiv.org/rss/${cat}`,
  })),
  // Jobs are India-focused: The Muse queried by Indian tech-hub cities
  // (on-site/hybrid roles), remote boards filtered to India-eligible
  // listings (india/apac/asia/worldwide) in src/resources.js.
  ...[1, 2, 3].map((page) => ({
    id: `themuse-${page}`,
    kind: 'job',
    type: 'json',
    url: `https://www.themuse.com/api/public/jobs?category=Software%20Engineering&category=Data%20Science&location=Bangalore%2C%20India&location=Mumbai%2C%20India&location=Hyderabad%2C%20India&location=Pune%2C%20India&location=Gurgaon%2C%20India&location=New%20Delhi%2C%20India&location=Chennai%2C%20India&location=Noida%2C%20India&page=${page}`,
    arrayPath: 'results',
  })),
  { id: 'remotive', kind: 'job', type: 'json', url: 'https://remotive.com/api/remote-jobs?limit=100', arrayPath: 'jobs' },
  { id: 'remoteok', kind: 'job', type: 'json', url: 'https://remoteok.com/api', arrayPath: null },
  { id: 'jobicy', kind: 'job', type: 'json', url: 'https://jobicy.com/api/v2/remote-jobs?count=50&geo=apac', arrayPath: 'jobs' },
  { id: 'himalayas', kind: 'job', type: 'json', url: 'https://himalayas.app/jobs/api?limit=50', arrayPath: 'jobs' },

  // Company career boards via public ATS APIs (Greenhouse/Lever/Ashby) —
  // keyless JSON, straight from the employer, India-filtered downstream.
  // Probed live 2026-07-21; boards that stop responding are tolerated.
  ...[
    ['greenhouse', 'phonepe', 'PhonePe', 'phonepe.com'],
    ['greenhouse', 'groww', 'Groww', 'groww.in'],
    ['greenhouse', 'postman', 'Postman', 'postman.com'],
    ['greenhouse', 'rubrik', 'Rubrik', 'rubrik.com'],
    ['greenhouse', 'databricks', 'Databricks', 'databricks.com'],
    ['greenhouse', 'stripe', 'Stripe', 'stripe.com'],
    ['greenhouse', 'mongodb', 'MongoDB', 'mongodb.com'],
    ['greenhouse', 'zscaler', 'Zscaler', 'zscaler.com'],
    ['greenhouse', 'twilio', 'Twilio', 'twilio.com'],
    ['greenhouse', 'elastic', 'Elastic', 'elastic.co'],
    ['greenhouse', 'hackerrank', 'HackerRank', 'hackerrank.com'],
    ['greenhouse', 'razorpaysoftwareprivatelimited', 'Razorpay', 'razorpay.com'],
    ['greenhouse', 'datadog', 'Datadog', 'datadoghq.com'],
    ['lever', 'meesho', 'Meesho', 'meesho.com'],
    ['lever', 'cred', 'CRED', 'cred.club'],
    ['ashby', 'atlan', 'Atlan', 'atlan.com'],
  ].map(([ats, slug, company, domain]) => ({
    id: `${ats}-${slug}`, kind: 'job', type: 'ats', ats, slug, company, domain,
  })),
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
