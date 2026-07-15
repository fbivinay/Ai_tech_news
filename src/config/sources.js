// RSS/Atom feeds from major AI & technology publishers.
// The platform never stores or republishes article bodies — feeds are used
// only to build headline + summary cards that link back to the source.
// `weight` feeds into hero-story scoring (rough editorial authority signal).

module.exports = [
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', homepage: 'https://techcrunch.com', weight: 9 },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', homepage: 'https://www.theverge.com', weight: 9 },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', homepage: 'https://arstechnica.com', weight: 8 },
  { name: 'VentureBeat', url: 'https://venturebeat.com/category/ai/feed/', homepage: 'https://venturebeat.com', weight: 8 },
  { name: 'Wired', url: 'https://www.wired.com/feed/rss', homepage: 'https://www.wired.com', weight: 8 },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', homepage: 'https://www.technologyreview.com', weight: 9 },
  { name: 'Engadget', url: 'https://www.engadget.com/rss.xml', homepage: 'https://www.engadget.com', weight: 7 },
  { name: 'ZDNET', url: 'https://www.zdnet.com/news/rss.xml', homepage: 'https://www.zdnet.com', weight: 6 },
  { name: 'The Register', url: 'https://www.theregister.com/headlines.atom', homepage: 'https://www.theregister.com', weight: 6 },
  { name: 'AI News', url: 'https://www.artificialintelligence-news.com/feed/', homepage: 'https://www.artificialintelligence-news.com', weight: 6 },
  { name: 'MarkTechPost', url: 'https://www.marktechpost.com/feed/', homepage: 'https://www.marktechpost.com', weight: 5 },
  { name: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/', homepage: 'https://blog.google/technology/ai/', weight: 8 },
];
