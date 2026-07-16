// RSS/Atom feeds from established AI & technology publishers.
// The platform never stores or republishes article bodies — feeds are used
// only to build headline + summary cards that link back to the source.
// `weight` feeds into hero/trending scoring (rough editorial authority signal).

module.exports = [
  // — Major tech press —
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', homepage: 'https://techcrunch.com', weight: 9 },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', homepage: 'https://www.theverge.com', weight: 9 },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', homepage: 'https://arstechnica.com', weight: 8 },
  { name: 'Wired', url: 'https://www.wired.com/feed/rss', homepage: 'https://www.wired.com', weight: 8 },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', homepage: 'https://www.technologyreview.com', weight: 9 },
  { name: 'Engadget', url: 'https://www.engadget.com/rss.xml', homepage: 'https://www.engadget.com', weight: 7 },
  { name: 'ZDNET', url: 'https://www.zdnet.com/news/rss.xml', homepage: 'https://www.zdnet.com', weight: 6 },
  { name: 'The Register', url: 'https://www.theregister.com/headlines.atom', homepage: 'https://www.theregister.com', weight: 6 },
  { name: 'CNET', url: 'https://www.cnet.com/rss/news/', homepage: 'https://www.cnet.com', weight: 6 },
  { name: 'Gizmodo', url: 'https://gizmodo.com/feed', homepage: 'https://gizmodo.com', weight: 6 },
  { name: 'TechRadar', url: 'https://www.techradar.com/feeds/articletype/news', homepage: 'https://www.techradar.com', weight: 5 },
  { name: 'The Next Web', url: 'https://thenextweb.com/feed', homepage: 'https://thenextweb.com', weight: 6 },
  { name: 'Digital Trends', url: 'https://www.digitaltrends.com/feed/', homepage: 'https://www.digitaltrends.com', weight: 5 },
  { name: 'TechSpot', url: 'https://www.techspot.com/backend.xml', homepage: 'https://www.techspot.com', weight: 5 },
  { name: "Tom's Hardware", url: 'https://www.tomshardware.com/feeds/all', homepage: 'https://www.tomshardware.com', weight: 6 },
  { name: '9to5Google', url: 'https://9to5google.com/feed/', homepage: 'https://9to5google.com', weight: 5 },
  { name: '9to5Mac', url: 'https://9to5mac.com/feed/', homepage: 'https://9to5mac.com', weight: 5 },
  { name: 'Android Authority', url: 'https://www.androidauthority.com/feed/', homepage: 'https://www.androidauthority.com', weight: 5 },

  // — Mainstream press, technology desks —
  { name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', homepage: 'https://www.bbc.com/news/technology', weight: 9 },
  { name: 'The Guardian Tech', url: 'https://www.theguardian.com/uk/technology/rss', homepage: 'https://www.theguardian.com/technology', weight: 8 },
  { name: 'NYT Technology', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml', homepage: 'https://www.nytimes.com/section/technology', weight: 9 },
  { name: 'CNBC Technology', url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html', homepage: 'https://www.cnbc.com/technology/', weight: 8 },

  // — AI-focused —
  { name: 'VentureBeat', url: 'https://venturebeat.com/category/ai/feed/', homepage: 'https://venturebeat.com', weight: 8 },
  { name: 'AI News', url: 'https://www.artificialintelligence-news.com/feed/', homepage: 'https://www.artificialintelligence-news.com', weight: 6 },
  { name: 'MarkTechPost', url: 'https://www.marktechpost.com/feed/', homepage: 'https://www.marktechpost.com', weight: 5 },
  { name: 'The Decoder', url: 'https://the-decoder.com/feed/', homepage: 'https://the-decoder.com', weight: 5 },
  { name: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/', homepage: 'https://blog.google/technology/ai/', weight: 8 },
  { name: 'OpenAI', url: 'https://openai.com/news/rss.xml', homepage: 'https://openai.com/news/', weight: 8 },
  { name: 'NVIDIA Blog', url: 'https://blogs.nvidia.com/feed/', homepage: 'https://blogs.nvidia.com', weight: 6 },
  { name: 'AWS ML Blog', url: 'https://aws.amazon.com/blogs/machine-learning/feed/', homepage: 'https://aws.amazon.com/blogs/machine-learning/', weight: 5 },
  { name: 'IEEE Spectrum', url: 'https://spectrum.ieee.org/feeds/feed.rss', homepage: 'https://spectrum.ieee.org', weight: 7 },

  // — Security —
  { name: 'Bleeping Computer', url: 'https://www.bleepingcomputer.com/feed/', homepage: 'https://www.bleepingcomputer.com', weight: 6 },
  { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', homepage: 'https://thehackernews.com', weight: 6 },
  { name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/', homepage: 'https://krebsonsecurity.com', weight: 7 },

  // — India tech & startups —
  { name: 'Economic Times Tech', url: 'https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms', homepage: 'https://economictimes.indiatimes.com/tech', weight: 7 },
  { name: 'Inc42', url: 'https://inc42.com/feed/', homepage: 'https://inc42.com', weight: 6 },
];
