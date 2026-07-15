// Importance scoring for hero-story selection.
// Signals: breaking/launch/funding/M&A/policy/security keywords,
// source authority, image availability, and recency decay.

const SIGNALS = [
  { points: 30, pattern: /\bbreaking\b/i },
  { points: 18, pattern: /\blaunch(es|ed)?\b|\bunveil(s|ed)?\b|\bintroduc(es|ed)\b|\breleases?\b|\bannounc(es|ed)\b|\bdebuts?\b/i },
  { points: 16, pattern: /\bacquires?\b|\bacquisition\b|\bmerger\b|\bbuys\b|\btakeover\b/i },
  { points: 14, pattern: /\braises?\b|\bfunding\b|\bvaluation\b|\bIPO\b|\bseries [a-e]\b/i },
  { points: 12, pattern: /\$\d+(\.\d+)?\s?(billion|bn|B)\b/i },
  { points: 14, pattern: /\bgpt-?\d|\bclaude\b|\bgemini\b|\bllama\b|frontier model|\bAGI\b/i },
  { points: 12, pattern: /\bbreakthrough\b|\bfirst[- ]ever\b|\brecord\b|\bmilestone\b/i },
  { points: 12, pattern: /\bregulat|\bAI act\b|\bexecutive order\b|\bantitrust\b|\bban(s|ned)\b/i },
  { points: 12, pattern: /\bbreach\b|\bhack(ed)?\b|\boutage\b|\bvulnerabilit|\bzero-day\b/i },
  { points: 8, pattern: /\bopenai\b|\banthropic\b|\bgoogle\b|\bmicrosoft\b|\bmeta\b|\bapple\b|\bnvidia\b|\bamazon\b/i },
  { points: 6, pattern: /\bmillions? of users\b|\bworldwide\b|\bglobal\b|\bindustry\b/i },
];

// Newsletter digests, roundups, and deal posts shouldn't lead the homepage.
const ROUNDUP_PENALTY = /newsletter|\bdigest\b|\broundup\b|\brecap\b|week in review|daily brief|^the download\b|\bdeals?\b|best .* (deals|of 20\d\d)|\bgift guide\b|\bquiz\b/i;

const HALF_LIFE_HOURS = 8;

function scoreItem(item, sourceWeight = 5) {
  const text = `${item.title} ${item.excerpt || ''}`;
  let score = sourceWeight;

  for (const { points, pattern } of SIGNALS) {
    if (pattern.test(text)) score += points;
  }
  if (ROUNDUP_PENALTY.test(item.title)) score *= 0.25;
  if (item.image) score += 6;

  const ageHours = Math.max(0, (Date.now() - new Date(item.publishedAt).getTime()) / 36e5);
  score *= Math.pow(0.5, ageHours / HALF_LIFE_HOURS);

  return Math.round(score * 100) / 100;
}

module.exports = { scoreItem };
