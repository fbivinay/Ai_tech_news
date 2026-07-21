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
  { id: 'remoteok', kind: 'job', type: 'json', url: 'https://remoteok.com/api', arrayPath: null },
  { id: 'wwr', kind: 'job', type: 'rss', url: 'https://weworkremotely.com/categories/remote-programming-jobs.rss' },
  { id: 'arbeitnow', kind: 'job', type: 'json', url: 'https://www.arbeitnow.com/api/job-board-api', arrayPath: 'data' },
  { id: 'jobicy', kind: 'job', type: 'json', url: 'https://jobicy.com/api/v2/remote-jobs?count=50', arrayPath: 'jobs' },
  { id: 'himalayas', kind: 'job', type: 'json', url: 'https://himalayas.app/jobs/api?limit=50', arrayPath: 'jobs' },
  { id: 'themuse', kind: 'job', type: 'json', url: 'https://www.themuse.com/api/public/jobs?category=Software%20Engineering&category=Data%20Science&page=1', arrayPath: 'results' },
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
