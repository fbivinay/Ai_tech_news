const assert = require('assert');
const {
  makeRecord, normalizeArxiv, normalizeRemoteOK, normalizeWWR,
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

console.log('resource-normalize.test OK');
