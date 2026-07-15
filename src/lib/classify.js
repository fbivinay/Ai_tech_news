// Keyword-based classification: category, company tags, region.
// Runs on headline + excerpt only (no article bodies are stored).

const CATEGORY_RULES = [
  { category: 'AI Models', patterns: [/\bgpt-?\d/i, /\bclaude\b/i, /\bgemini\b/i, /\bllama\b/i, /\bmistral\b/i, /\bchatgpt\b/i, /large language model/i, /\bLLMs?\b/, /foundation model/i, /frontier model/i, /\bcopilot\b/i, /generative ai/i, /\bmultimodal\b/i, /text-to-(image|video|speech)/i, /\bdiffusion model/i] },
  { category: 'Research', patterns: [/\bresearch(ers)?\b/i, /\bstudy\b/i, /\bpaper\b/i, /\bbreakthrough\b/i, /\bbenchmark\b/i, /\barxiv\b/i, /\bscientists?\b/i, /\bquantum\b/i, /\bneural network/i, /\balgorithm\b/i] },
  { category: 'Startups & Funding', patterns: [/\braises?\b.*\$(\d|\d.*(million|billion))/i, /\bfunding round/i, /\bseries [a-e]\b/i, /\bseed round/i, /\bvaluation\b/i, /\bventure capital\b/i, /\bstartup\b/i, /\bIPO\b/, /\bacquisition\b/i, /\bacquires?\b/i, /\bmerger\b/i, /\bunicorn\b/i] },
  { category: 'Policy & Regulation', patterns: [/\bregulat(ion|ors?|e)\b/i, /\bantitrust\b/i, /\blawsuit\b/i, /\bcourt\b/i, /\bcongress\b/i, /\bsenate\b/i, /\bEU\b/, /\bAI act\b/i, /\bexecutive order\b/i, /\bban(s|ned)?\b/i, /\bprivacy law/i, /\bgovernment\b/i, /\bwhite house\b/i, /\bFTC\b/, /\bDOJ\b/, /\bcopyright\b/i, /\btariff/i] },
  { category: 'Security', patterns: [/\bbreach\b/i, /\bhack(ed|ers?)?\b/i, /\bransomware\b/i, /\bmalware\b/i, /\bvulnerabilit/i, /\bcybersecurity\b/i, /\bphishing\b/i, /\bexploit\b/i, /\bzero-day\b/i, /\bdata leak/i, /\bspyware\b/i] },
  { category: 'Hardware & Chips', patterns: [/\bchips?\b/i, /\bsemiconductor/i, /\bGPUs?\b/i, /\bprocessors?\b/i, /\bTSMC\b/i, /\bfoundry\b/i, /\bsilicon\b/i, /\bdata ?cent(er|re)s?\b/i, /\bwafer\b/i, /\bASML\b/i, /\bNPU\b/i] },
  { category: 'Robotics', patterns: [/\brobots?\b/i, /\brobotics?\b/i, /\bhumanoid\b/i, /\bdrones?\b/i, /\bautonomous vehicle/i, /\bself-driving\b/i, /\brobotaxi\b/i] },
  { category: 'Cloud & Enterprise', patterns: [/\bcloud\b/i, /\bAWS\b/, /\bazure\b/i, /\benterprise\b/i, /\bSaaS\b/i, /\bkubernetes\b/i, /\bworkspace\b/i, /\bproductivity suite/i] },
  { category: 'Consumer Tech', patterns: [/\biphone\b/i, /\bandroid\b/i, /\bsmartphone\b/i, /\blaptop\b/i, /\bwearable/i, /\bheadset\b/i, /\bsmartwatch\b/i, /\bstreaming\b/i, /\bgaming\b/i, /\bconsole\b/i, /\bapp store\b/i, /\bearbuds\b/i, /\bTV\b/] },
  { category: 'Open Source', patterns: [/\bopen[- ]source\b/i, /\bopen[- ]weights?\b/i, /\bgithub\b/i, /\blinux\b/i, /\bhugging ?face\b/i] },
];

const COMPANIES = [
  ['OpenAI', /\bopenai\b|\bchatgpt\b|\bgpt-?\d/i],
  ['Anthropic', /\banthropic\b|\bclaude\b/i],
  ['Google', /\bgoogle\b|\balphabet\b|\bgemini\b|\bdeepmind\b|\bandroid\b|\byoutube\b/i],
  ['Microsoft', /\bmicrosoft\b|\bazure\b|\bwindows\b|\bxbox\b|\bcopilot\b/i],
  ['Meta', /\bmeta\b|\bfacebook\b|\binstagram\b|\bwhatsapp\b|\bllama\b/i],
  ['Apple', /\bapple\b|\biphone\b|\bipad\b|\bmacos\b|\bmacbook\b/i],
  ['Nvidia', /\bnvidia\b/i],
  ['Amazon', /\bamazon\b|\baws\b|\balexa\b/i],
  ['Tesla', /\btesla\b/i],
  ['xAI', /\bxai\b|\bgrok\b/i],
  ['Mistral', /\bmistral\b/i],
  ['Samsung', /\bsamsung\b/i],
  ['Intel', /\bintel\b/i],
  ['AMD', /\bAMD\b/],
  ['TSMC', /\btsmc\b/i],
  ['Qualcomm', /\bqualcomm\b/i],
  ['IBM', /\bIBM\b/],
  ['Oracle', /\boracle\b/i],
  ['Salesforce', /\bsalesforce\b/i],
  ['SpaceX', /\bspacex\b|\bstarlink\b/i],
  ['Netflix', /\bnetflix\b/i],
  ['Uber', /\buber\b/i],
  ['ByteDance', /\bbytedance\b|\btiktok\b/i],
  ['Baidu', /\bbaidu\b/i],
  ['Alibaba', /\balibaba\b|\bqwen\b/i],
  ['DeepSeek', /\bdeepseek\b/i],
  ['Hugging Face', /\bhugging ?face\b/i],
  ['Perplexity', /\bperplexity\b/i],
  ['Waymo', /\bwaymo\b/i],
  ['Palantir', /\bpalantir\b/i],
];

const REGIONS = [
  ['China', /\bchina\b|\bchinese\b|\bbeijing\b|\bshanghai\b|\bshenzhen\b/i],
  ['Europe', /\beurope(an)?\b|\bEU\b|\bbrussels\b|\bgermany\b|\bfrance\b|\bspain\b|\bitaly\b|\bnetherlands\b/i],
  ['UK', /\bUK\b|\bbritain\b|\bbritish\b|\blondon\b|\bengland\b/i],
  ['India', /\bindia(n)?\b|\bnew delhi\b|\bbangalore\b|\bbengaluru\b/i],
  ['Japan', /\bjapan(ese)?\b|\btokyo\b/i],
  ['South Korea', /\bsouth korea(n)?\b|\bseoul\b/i],
  ['United States', /\bU\.?S\.?\b|\bunited states\b|\bamerica(n)?\b|\bwashington\b|\bcalifornia\b|\bsilicon valley\b|\bcongress\b|\bwhite house\b/i],
];

function classify(title, excerpt) {
  const text = `${title} ${excerpt || ''}`;

  let category = 'Tech';
  let bestHits = 0;
  for (const rule of CATEGORY_RULES) {
    const hits = rule.patterns.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);
    if (hits > bestHits) {
      bestHits = hits;
      category = rule.category;
    }
  }

  const companies = [];
  for (const [name, pattern] of COMPANIES) {
    if (pattern.test(text)) companies.push(name);
    if (companies.length >= 4) break;
  }

  let region = 'Global';
  for (const [name, pattern] of REGIONS) {
    if (pattern.test(text)) { region = name; break; }
  }

  return { category, companies, region };
}

module.exports = { classify };
