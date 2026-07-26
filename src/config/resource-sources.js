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
  // Probed live 2026-07-21/24; boards that stop responding are tolerated.
  // Each entry below was checked for a non-zero count of India-tagged
  // postings before being added (a global board with zero India hits is
  // pure fetch cost for no cards).
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
    ['greenhouse', 'highradius', 'HighRadius', 'highradius.com'],
    ['greenhouse', 'okta', 'Okta', 'okta.com'],
    ['greenhouse', 'gitlab', 'GitLab', 'gitlab.com'],
    ['greenhouse', 'newrelic', 'New Relic', 'newrelic.com'],
    ['greenhouse', 'netskope', 'Netskope', 'netskope.com'],
    ['greenhouse', 'coinbase', 'Coinbase', 'coinbase.com'],
    ['greenhouse', 'fastly', 'Fastly', 'fastly.com'],
    ['lever', 'meesho', 'Meesho', 'meesho.com'],
    ['lever', 'cred', 'CRED', 'cred.club'],
    ['lever', 'highspot', 'Highspot', 'highspot.com'],
    ['ashby', 'atlan', 'Atlan', 'atlan.com'],
    ['ashby', 'openai', 'OpenAI', 'openai.com'],
  ].map(([ats, slug, company, domain]) => ({
    id: `${ats}-${slug}`, kind: 'job', type: 'ats', ats, slug, company, domain,
  })),
  // Unstop — India's hackathon/workshop platform. India-filtered + tech-
  // topic-filtered downstream in resource-normalize.js. TTL'd: listings
  // don't turn over minute to minute.
  {
    id: 'unstop-hackathons', kind: 'hackathon', type: 'json', ttlMs: 2 * 3600e3,
    url: 'https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&oppstatus=open&page=1&per_page=100',
    arrayPath: 'data.data',
  },
  {
    id: 'unstop-workshops', kind: 'event', type: 'json', ttlMs: 2 * 3600e3,
    url: 'https://unstop.com/api/public/opportunity/search-result?opportunity=workshops&oppstatus=open&page=1&per_page=100',
    arrayPath: 'data.data',
  },

  // Courses — live provider catalogs. Heavy payloads, so refreshed on a TTL
  // (merge keeps cards between fetches), not every 60s cycle.
  { id: 'mslearn', kind: 'course', type: 'json', ttlMs: 6 * 3600e3, max: 150, url: 'https://learn.microsoft.com/api/catalog/?type=learningPaths&locale=en-us', arrayPath: 'learningPaths' },
  ...[0, 100, 200].map((start) => ({
    id: `coursera-${start}`, kind: 'course', type: 'json', ttlMs: 6 * 3600e3,
    url: `https://api.coursera.org/api/courses.v1?start=${start}&limit=100&fields=name,photoUrl,slug`,
    arrayPath: 'elements',
  })),
  // Free multi-part course playlists from reputable teaching channels — no
  // keyless catalog API exists for most major course *websites* (Udemy/edX/
  // Pluralsight/Khan Academy/Class Central all require auth or block
  // server-side requests; checked live 2026-07-26), so this is the one
  // other real source of variety. Each entry is ONE playlist (a real,
  // hand-picked structured course — not a channel's whole upload history,
  // which is mostly unrelated one-off videos): the playlist's own title +
  // its first video's thumbnail become the course card, and the card links
  // to the playlist, never a single video. Picked and video-count-checked
  // live 2026-07-26 from each channel's public playlist list.
  ...[
    ['ytpl-fcc-frontend-path', 'PLWKjhJtqVAbmMuZ3saqRIBimAKIMYkt0E', 'freeCodeCamp.org'],
    ['ytpl-fcc-backend-path', 'PLWKjhJtqVAbn21gs5UnLhCQ82f923WCgM', 'freeCodeCamp.org'],
    ['ytpl-fcc-data-analysis', 'PLWKjhJtqVAblvI1i46ScbKV2jH1gdL7VQ', 'freeCodeCamp.org'],
    ['ytpl-fcc-devops', 'PLWKjhJtqVAbkzvvpY12KkfiIGso9A_Ixs', 'freeCodeCamp.org'],
    ['ytpl-traversy-js-under-hood', 'PLillGF-Rfqbars4vKNtpcWVDUpVOVTlgB', 'Traversy Media'],
    ['ytpl-traversy-mern', 'PLillGF-RfqbbiTGgA77tGO426V3hRF9iE', 'Traversy Media'],
    ['ytpl-traversy-react-django', 'PLillGF-RfqbbRA-CIUxlxkUpbq0IFkX60', 'Traversy Media'],
    ['ytpl-traversy-graphql', 'PLillGF-RfqbZrjw48EXLdM4dsOhURCLZx', 'Traversy Media'],
    ['ytpl-mosh-frontend', 'PLTjRvDozrdlw5En5v2xrBr_EqieHf7hGs', 'Programming with Mosh'],
    ['ytpl-mosh-backend', 'PLTjRvDozrdlynYXGUfyyMZdrQ0Sz27aud', 'Programming with Mosh'],
    ['ytpl-mosh-python', 'PLTjRvDozrdlxj5wgH4qkvwSOdHLOCx10f', 'Programming with Mosh'],
    ['ytpl-mosh-javascript', 'PLTjRvDozrdlxEIuOBZkMAK5uiqp8rHUax', 'Programming with Mosh'],
    ['ytpl-tim-rust', 'PLzMcBGfZo4-nyLTlSRBvo0zjSnCnqjHYQ', 'Tech With Tim'],
    ['ytpl-tim-cpp', 'PLzMcBGfZo4-lmGC8VW0iu6qfMHjy7gLQ3', 'Tech With Tim'],
    ['ytpl-tim-linux', 'PLzMcBGfZo4-nUIIMsz040W_X-03QH5c5h', 'Tech With Tim'],
    ['ytpl-tim-react', 'PLzMcBGfZo4-nRV61oEu3KfMwWKI571uPT', 'Tech With Tim'],
    ['ytpl-netninja-react-native', 'PL4cUxeGkcC9hNTz3sxqGTfxAwU-DIHJd2', 'The Net Ninja'],
    ['ytpl-netninja-django-htmx', 'PL4cUxeGkcC9hgO93oEHPBMuLA20y0SBVK', 'The Net Ninja'],
    ['ytpl-netninja-git', 'PL4cUxeGkcC9j2pbmcA93DR1A3m7VEgSxK', 'The Net Ninja'],
    ['ytpl-netninja-unit-testing', 'PL4cUxeGkcC9iyuClsf48SSgsJPBStHo7F', 'The Net Ninja'],
    ['ytpl-academind-aws', 'PL55RiY5tL51rudermnWTq1LlGC1BL1g3l', 'Academind'],
    ['ytpl-academind-python-data', 'PL55RiY5tL51o5jBXR1h2JvFm0L-fbThG4', 'Academind'],
    ['ytpl-academind-rest-api', 'PL55RiY5tL51q4D-B63KBnygU6opNPFk_q', 'Academind'],
    ['ytpl-academind-webdev-beginners', 'PL55RiY5tL51rv_vo3TM3Byu71RYchX_l_', 'Academind'],
    ['ytpl-kevinpowell-html-css', 'PL4-IK0AVhVjOJs_UjdQeyEZ_cmEV3uJvx', 'Kevin Powell'],
    ['ytpl-kevinpowell-new-css', 'PL4-IK0AVhVjNMhAxy8UC-SRbaPD5daKnH', 'Kevin Powell'],
    ['ytpl-neetcode-150', 'PLot-Xpze53lfJlNm5S0fq3AmoyugNGqPk', 'NeetCode'],
    ['ytpl-neetcode-system-design', 'PLot-Xpze53le35rQuIbRET3YwEtrcJfdt', 'NeetCode'],
    ['ytpl-neetcode-dp', 'PLot-Xpze53lcvx_tjrr_m2lgD2NsRHlNO', 'NeetCode'],
    ['ytpl-neetcode-graphs', 'PLot-Xpze53ldBT_7QA8NVot219jFNr_GI', 'NeetCode'],
    ['ytpl-corey-python-beginner', 'PL-osiE80TeTskrapNbzXhwoFUiLCjGgY7', 'Corey Schafer'],
    ['ytpl-corey-django', 'PL-osiE80TeTtoQCKZ03TU5fNfx2UY6U4p', 'Corey Schafer'],
    ['ytpl-corey-flask', 'PL-osiE80TeTs4UjLw5MM6OjgkjFeUxCYH', 'Corey Schafer'],
    ['ytpl-corey-pandas', 'PL-osiE80TeTsWmV9i9c58mdDCSskIFdDS', 'Corey Schafer'],
    ['ytpl-cs50x-2025', 'PLhQjrBD2T383q7Vn8QnTsVgSvyLpsqL_R', 'CS50'],
    ['ytpl-cs50-cybersecurity', 'PLhQjrBD2T383Cqo5I1oRrbC1EKRAKGKUE', 'CS50'],
    ['ytpl-cs50-r', 'PLhQjrBD2T382yfNp_-xzX244d-O9W6YmD', 'CS50'],
    ['ytpl-sentdex-nn-from-scratch', 'PLQVvvaa0QuDcjD5BAw2DxE6OF2tius3V3', 'sentdex'],
    ['ytpl-sentdex-pytorch', 'PLQVvvaa0QuDdeMyHEYc0gxFpYwHY2Qfdh', 'sentdex'],
    ['ytpl-sentdex-reinforcement-learning', 'PLQVvvaa0QuDezJFIOU5wDdfy4e9vdnx-7', 'sentdex'],
    ['ytpl-sentdex-pandas', 'PLQVvvaa0QuDfSfqQuee6K8opKtZsh7sA9', 'sentdex'],
  ].map(([id, playlistId, channel]) => ({
    id, kind: 'course', type: 'ytplaylist', channel, ttlMs: 6 * 3600e3,
    url: `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`,
  })),

  // Conferences — confs.tech community data, current + next year per topic.
  ...(() => {
    const year = new Date().getFullYear();
    const topics = ['data', 'python', 'devops', 'security', 'general'];
    return [year, year + 1].flatMap((y) => topics.map((topic) => ({
      id: `confstech-${y}-${topic}`, kind: 'event', type: 'json', ttlMs: 6 * 3600e3,
      url: `https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences/${y}/${topic}.json`,
      arrayPath: null,
    })));
  })(),
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
