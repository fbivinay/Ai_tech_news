const assert = require('assert');
const {
  makeRecord, normalizeArxiv, normalizeRemoteOK, normalizeWWR,
  normalizeArbeitnow, normalizeJobicy, normalizeHimalayas, normalizeMuse,
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

// Sheet events: past-dated events are dropped
assert.strictEqual(
  normalizeSheetRow({ title: 'Old Conf', link: 'https://x.com/c', type: 'Conference', date: '2000-01-01' }, 'event'),
  null,
);
const evt = normalizeSheetRow({ title: 'Future Conf', link: 'https://x.com/c2', type: 'Workshop', date: '2099-01-01', city: 'Berlin', mode: 'in-person', free: 'yes' }, 'event');
assert.strictEqual(evt.kind, 'event');
assert.strictEqual(evt.meta.type, 'workshop');
assert.strictEqual(evt.meta.free, true);

// Sheet courses: cert flag parsed
const course = normalizeSheetRow({ title: 'Intro to ML', link: 'https://x.com/course', provider: 'DeepLearning.AI', level: 'Beginner', cert: 'Yes' }, 'course');
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

console.log('resource-normalize.test OK');
