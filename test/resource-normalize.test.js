const assert = require('assert');
const {
  makeRecord, normalizeArxiv, normalizeRemoteOK, normalizeWWR,
  normalizeArbeitnow, normalizeJobicy, normalizeHimalayas, normalizeMuse,
  normalizeRemotive, isIndiaEligibleJob, expFromText,
  normalizeGreenhouse, normalizeLever, normalizeAshby,
  normalizeDevpost, normalizeSheetRow,
} = require('../src/lib/resource-normalize');

// makeRecord drops records with no usable link or title
assert.strictEqual(makeRecord({ kind: 'paper', title: 'x', link: 'not a url' }), null);
assert.strictEqual(makeRecord({ kind: 'paper', title: '', link: 'https://x.com' }), null);

// arXiv: strips the trailing "(arXiv:...)" from the title
const paper = normalizeArxiv({
  title: 'Deep Nets Are Great. (arXiv:2401.00001v1 [cs.AI])',
  link: 'https://arxiv.org/abs/2401.00001',
  contentSnippet: 'We show that deep nets are great.',
  creator: 'Ada Lovelace, Alan Turing',
  isoDate: '2026-07-01T00:00:00Z',
});
assert.strictEqual(paper.kind, 'paper');
assert.strictEqual(paper.title, 'Deep Nets Are Great');
assert.strictEqual(paper.meta.authors, 'Ada Lovelace, Alan Turing');

// RemoteOK: maps position/company/url
const job = normalizeRemoteOK({ position: 'ML Engineer', company: 'Acme', url: 'https://remoteok.com/j/1', location: 'Worldwide', date: '2026-07-01' });
assert.strictEqual(job.kind, 'job');
assert.strictEqual(job.title, 'ML Engineer');
assert.strictEqual(job.meta.company, 'Acme');

// WWR: splits "Company: Role" title
const wwr = normalizeWWR({ title: 'Acme: Senior Backend Engineer', link: 'https://weworkremotely.com/j/2', contentSnippet: 'Remote role' });
assert.strictEqual(wwr.title, 'Senior Backend Engineer');
assert.strictEqual(wwr.meta.company, 'Acme');

// Devpost: ended hackathons are dropped, live ones kept
assert.strictEqual(normalizeDevpost({ title: 'Old', url: 'https://devpost.com/h/1', open_state: 'ended' }), null);
const hack = normalizeDevpost({ title: 'AI Jam', url: 'https://devpost.com/h/2', open_state: 'open', submission_period_dates: 'Aug 1 - Aug 30, 2026', prize_amount: '<span>$10,000</span>', online: true, thumbnail_url: '//challengepost.com/thumb.png' });
assert.strictEqual(hack.kind, 'hackathon');
assert.strictEqual(hack.meta.deadline, 'Aug 1 - Aug 30, 2026');
assert.strictEqual(hack.meta.mode, 'online');
assert.strictEqual(hack.meta.prize, '$10,000'); // HTML stripped from prize_amount
assert.strictEqual(hack.image, 'https://challengepost.com/thumb.png'); // protocol-relative thumbnail upgraded to https

// Sheet courses: cert flag parsed
const course = normalizeSheetRow({ title: 'Intro to ML', link: 'https://x.com/course', provider: 'DeepLearning.AI', level: 'Beginner', cert: 'Yes' });
assert.strictEqual(course.kind, 'course');
assert.strictEqual(course.meta.cert, true);
assert.strictEqual(course.source, 'DeepLearning.AI');

// Jobicy: salary range formatted, remote mode, logo carried
const jj = normalizeJobicy({ url: 'https://jobicy.com/j/1', jobTitle: 'ML Engineer', companyName: 'Acme', companyLogo: 'https://x.com/l.png', jobGeo: 'Europe', jobType: ['full-time'], annualSalaryMin: 60000, annualSalaryMax: 90000, salaryCurrency: 'USD', pubDate: '2026-07-20 10:00:00' });
assert.strictEqual(jj.meta.salary, '$60k–$90k');
assert.strictEqual(jj.meta.mode, 'Remote');
assert.strictEqual(jj.meta.type, 'full-time');
assert.strictEqual(jj.image, 'https://x.com/l.png');

// Arbeitnow: remote flag → mode, unix created_at → ISO date
const ab = normalizeArbeitnow({ title: 'Backend Dev', url: 'https://arbeitnow.com/j/1', company_name: 'ACo', remote: false, job_types: ['contract'], location: 'Berlin', created_at: 1750000000 });
assert.strictEqual(ab.meta.mode, 'On-site');
assert.strictEqual(ab.meta.company, 'ACo');
assert.strictEqual(ab.meta.type, 'contract');
assert.ok(ab.date.startsWith('2025'));

// Himalayas: salary + location restrictions joined
const hi = normalizeHimalayas({ title: 'Platform Eng', applicationLink: 'https://himalayas.app/j/1', companyName: 'HCo', companyLogo: 'https://x.com/h.png', locationRestrictions: ['United States', 'Canada', 'UK'], minSalary: 100000, maxSalary: 150000, pubDate: 1750000000 });
assert.strictEqual(hi.meta.salary, '$100k–$150k');
assert.strictEqual(hi.meta.location, 'United States, Canada');

// The Muse: nested company/locations, remote detection from location name
const mu = normalizeMuse({ name: 'Software Engineer', refs: { landing_page: 'https://themuse.com/j/1' }, company: { name: 'MCo' }, locations: [{ name: 'Flexible / Remote' }], publication_date: '2026-07-20T00:00:00Z' });
assert.strictEqual(mu.meta.company, 'MCo');
assert.strictEqual(mu.meta.mode, 'Remote');

// RemoteOK: salary badge from salary_min/max
const rok = normalizeRemoteOK({ position: 'AI Eng', company: 'RCo', url: 'https://remoteok.com/j/9', salary_min: 80000, salary_max: 120000 });
assert.strictEqual(rok.meta.salary, '$80k–$120k');
assert.strictEqual(rok.meta.mode, 'Remote');

// Remotive: location + underscored job_type cleaned
const rv = normalizeRemotive({ title: 'Data Engineer', url: 'https://remotive.com/j/1', company_name: 'VCo', company_logo: 'https://x.com/v.png', candidate_required_location: 'India', salary: '₹20L–₹35L', job_type: 'full_time', publication_date: '2026-07-20T00:00:00' });
assert.strictEqual(rv.meta.location, 'India');
assert.strictEqual(rv.meta.type, 'full time');

// India eligibility: India named → yes; worldwide remote → yes; US-only remote → no; Berlin on-site → no
assert.strictEqual(isIndiaEligibleJob({ title: 'SWE', meta: { location: 'Bangalore, India', mode: '' } }), true);
assert.strictEqual(isIndiaEligibleJob({ title: 'SWE', meta: { location: 'Worldwide', mode: 'Remote' } }), true);
assert.strictEqual(isIndiaEligibleJob({ title: 'SWE', meta: { location: 'APAC', mode: 'Remote' } }), true);
assert.strictEqual(isIndiaEligibleJob({ title: 'SWE', meta: { location: 'USA', mode: 'Remote' } }), false);
assert.strictEqual(isIndiaEligibleJob({ title: 'SWE', meta: { location: 'Berlin', mode: 'On-site' } }), false);

// India eligibility: bare Indian city names count (ATS boards write "Bengaluru")
assert.strictEqual(isIndiaEligibleJob({ title: 'SWE', meta: { location: 'Bengaluru', mode: '' } }), true);
assert.strictEqual(isIndiaEligibleJob({ title: 'SWE', meta: { location: 'Gurugram', mode: '' } }), true);

// Experience extraction
assert.strictEqual(expFromText('We need 3+ years of Python experience'), '3+ yrs exp');
assert.strictEqual(expFromText('Requires 2-5 years in ML'), '2–5 yrs exp');
assert.strictEqual(expFromText('401k plan, no exp mentioned'), '');

// Salary from description text — Indian and USD forms; no range = no salary
const { salFromText } = require('../src/lib/resource-normalize');
assert.strictEqual(salFromText('CTC: ₹20,00,000 - ₹35,00,000 per annum'), '₹20,00,000–₹35,00,000');
assert.strictEqual(salFromText('Compensation 12-18 LPA plus ESOPs'), '₹12–18 LPA');
assert.strictEqual(salFromText('Pay range $120,000 - $160,000'), '$120,000–$160,000');
assert.strictEqual(salFromText('Great benefits and culture'), '');

// Job field classification — first match wins, engineering catch-all
const { classifyJobField } = require('../src/lib/resource-normalize');
assert.strictEqual(classifyJobField('Machine Learning Engineer'), 'ai');
assert.strictEqual(classifyJobField('Senior Data Engineer'), 'data');
assert.strictEqual(classifyJobField('Offensive Security Professional'), 'security');
assert.strictEqual(classifyJobField('Product Designer'), 'product');
assert.strictEqual(classifyJobField('Site Reliability Engineer'), 'devops');
assert.strictEqual(classifyJobField('Backend Developer'), 'engineering');

// Greenhouse: company/domain from src, favicon logo
const src = { company: 'PhonePe', domain: 'phonepe.com' };
const gh = normalizeGreenhouse({ title: 'Backend Engineer', absolute_url: 'https://boards.greenhouse.io/phonepe/jobs/1', location: { name: 'Bengaluru' }, updated_at: '2026-07-20T00:00:00Z' }, src);
assert.strictEqual(gh.meta.company, 'PhonePe');
assert.strictEqual(gh.meta.location, 'Bengaluru');
assert.ok(gh.image.includes('phonepe.com'));

// Lever: salary range + workplace type + exp from description
const lv = normalizeLever({ text: 'Data Scientist', hostedUrl: 'https://jobs.lever.co/meesho/1', createdAt: 1752000000000, workplaceType: 'hybrid', salaryRange: { min: 2000000, max: 3500000, currency: 'INR' }, categories: { location: 'Bangalore', commitment: 'Full-time' }, descriptionPlain: 'Minimum 4+ years experience' }, { company: 'Meesho', domain: 'meesho.com' });
assert.strictEqual(lv.meta.mode, 'Hybrid');
assert.strictEqual(lv.meta.salary, '₹2000k–₹3500k');
assert.strictEqual(lv.meta.experience, '4+ yrs exp');

// Ashby: compensation summary + secondary locations
const as = normalizeAshby({ title: 'Platform Engineer', jobUrl: 'https://jobs.ashbyhq.com/atlan/1', location: 'Bengaluru', secondaryLocations: [{ location: 'Mumbai' }], isRemote: false, employmentType: 'FullTime', compensation: { compensationTierSummary: '₹30L – ₹45L' }, publishedAt: '2026-07-20T00:00:00Z' }, { company: 'Atlan', domain: 'atlan.com' });
assert.strictEqual(as.meta.salary, '₹30L – ₹45L');
assert.strictEqual(as.meta.location, 'Bengaluru, Mumbai');

// Topic classification
const { classifyTopic, normalizeMsLearn, normalizeCoursera } = require('../src/lib/resource-normalize');
assert.strictEqual(classifyTopic('Build RAG applications'), 'RAG');
assert.strictEqual(classifyTopic('Intro to Large Language Models'), 'LLMs');
assert.strictEqual(classifyTopic('Deep Learning with PyTorch'), 'Deep Learning');
assert.strictEqual(classifyTopic('SQL for Beginners'), 'SQL');
assert.strictEqual(classifyTopic('Watercolor Painting'), '');

// MS Learn: free, image, popularity, duration
const msl = normalizeMsLearn({ title: 'Get started with AI agents', url: 'https://learn.microsoft.com/x', social_image_url: 'https://learn.microsoft.com/img.png', levels: ['beginner'], products: ['azure'], popularity: 0.9, duration_in_minutes: 125, last_modified: '2026-07-01' });
assert.strictEqual(msl.meta.free, true);
assert.strictEqual(msl.meta.category, 'AI Agents');
assert.strictEqual(msl.meta.duration, '2h');

// Coursera: off-topic dropped, tech kept with link from slug
assert.strictEqual(normalizeCoursera({ name: 'Guitar for Beginners', slug: 'guitar' }), null);
const cou = normalizeCoursera({ name: 'Machine Learning Specialization', slug: 'ml-spec', photoUrl: 'https://c.org/p.png' });
assert.strictEqual(cou.link, 'https://www.coursera.org/learn/ml-spec');
assert.strictEqual(cou.meta.category, 'Machine Learning');

console.log('resource-normalize.test OK');
