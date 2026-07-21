/* AI & Tech News — resource section pages (jobs, courses, hackathons,
   events/workshops/conferences) over /api/explore. Which section renders is
   decided by the URL (?kind=…&type=…); the header nav is the only switcher.
   Self-contained: repeats a few small helpers from app.js on purpose so the
   homepage stays untouched. ponytail: minor helper duplication with app.js;
   extract a common.js only if a third page appears. */

(() => {
  const KINDS = [
    { key: 'jobs', label: 'Jobs' },
    { key: 'courses', label: 'Courses' },
    { key: 'hackathons', label: 'Hackathons' },
    { key: 'events', label: 'Events' },
  ];
  // Workshops/Conferences are event-type pages of their own; plain Events
  // shows every type (sessions included).
  const EVENT_TYPE_LABELS = { workshop: 'Workshops', conference: 'Conferences' };

  const state = { tab: 'jobs', eventType: 'all', page: 1, hasMore: false, loading: false };

  const $ = (id) => document.getElementById(id);
  const titleEl = $('explore-title');
  const gridEl = $('explore-grid');
  const emptyEl = $('explore-empty');
  const moreBtn = $('explore-more');
  const toastEl = $('toast');
  const headerEl = document.querySelector('.site-header');

  /* ---------- Theme ---------- */
  if (localStorage.getItem('theme') === 'dark') document.documentElement.dataset.theme = 'dark';
  $('theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? '' : 'dark';
    localStorage.setItem('theme', dark ? 'light' : 'dark');
  });

  /* ---------- Consent gate (same contract as the homepage) ---------- */
  const CONSENT_KEY = 'cookie-consent';
  function initConsentGate() {
    if (localStorage.getItem(CONSENT_KEY)) return;
    const gate = $('consent-gate');
    document.body.style.overflow = 'hidden';
    gate.hidden = false;
    requestAnimationFrame(() => gate.classList.add('show'));
    const choose = (value) => {
      localStorage.setItem(CONSENT_KEY, value);
      gate.classList.remove('show');
      document.body.style.overflow = '';
      setTimeout(() => { gate.hidden = true; }, 250);
    };
    $('consent-necessary').addEventListener('click', () => choose('necessary'));
    $('consent-all').addEventListener('click', () => choose('all'));
  }
  initConsentGate();

  /* ---------- Header shadow on scroll ---------- */
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { headerEl.classList.toggle('scrolled', window.scrollY > 8); ticking = false; });
  }, { passive: true });

  /* ---------- Helpers ---------- */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  async function getJSON(url) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const res = await fetch(url);
      if (!res.ok && res.status !== 202) throw new Error(`${url} → ${res.status}`);
      const body = await res.json();
      if (!body.warming) return body;
      await new Promise((r) => setTimeout(r, 2500));
    }
    throw new Error('server did not warm up in time');
  }

  let toastTimer = null;
  function showExternalNotice(sourceName) {
    $('toast-dest').textContent = `Opening on ${sourceName || 'the source'}`;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => { toastEl.hidden = true; }, 250);
    }, 2600);
  }

  function openLink(item) {
    showExternalNotice(item.source);
    window.open(item.link, '_blank', 'noopener');
  }

  /* ---------- Card ---------- */
  function badgesFor(item) {
    const out = [];
    const m = item.meta || {};
    if (item.kind === 'paper' && m.authors) out.push({ text: m.authors });
    if (item.kind === 'job') {
      if (m.company) out.push({ text: m.company });
      if (m.location) out.push({ text: m.location });
    }
    if (item.kind === 'event') {
      if (m.type) out.push({ text: m.type.charAt(0).toUpperCase() + m.type.slice(1) });
      if (item.date) out.push({ text: new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) });
      if (m.city) out.push({ text: m.city });
      if (m.mode) out.push({ text: m.mode });
      if (m.free) out.push({ text: 'Free', free: true });
    }
    if (item.kind === 'course') {
      if (m.provider) out.push({ text: m.provider });
      if (m.level) out.push({ text: m.level });
      if (m.cert) out.push({ text: 'Certificate', free: true });
    }
    if (item.kind === 'hackathon') {
      if (m.deadline) out.push({ text: m.deadline });
      if (m.mode) out.push({ text: m.mode });
      if (m.prize) out.push({ text: m.prize });
    }
    return out;
  }

  function resourceCard(item, i) {
    const card = el('article', 'news-card');
    card.style.setProperty('--i', Math.min(i, 11));

    const info = el('div', 'card-info');
    const title = el('h3', 'card-title');
    const link = el('a', null, item.title);
    link.href = item.link;
    link.target = '_blank';
    link.rel = 'noopener external';
    link.tabIndex = -1; // card itself is the tab stop; avoid a second stop on the inner link
    link.addEventListener('click', (e) => { e.preventDefault(); openLink(item); });
    title.append(link);
    info.append(title);

    if (item.source) {
      const meta = el('div', 'meta-row');
      meta.append(el('span', 'source-name', item.source));
      info.append(meta);
    }
    if (item.blurb) info.append(el('p', 'card-blurb', item.blurb));

    const badges = badgesFor(item);
    if (badges.length) {
      const row = el('div', 'res-badges');
      for (const b of badges) row.append(el('span', `res-badge${b.free ? ' free' : ''}`, b.text));
      info.append(row);
    }

    card.append(info);
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    card.setAttribute('aria-label', `${item.title} — open on ${item.source || 'source'}`);
    card.addEventListener('click', (e) => { if (!e.target.closest('a')) openLink(item); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === card) openLink(item); });
    return card;
  }

  function tabParams(page) {
    const params = new URLSearchParams({ kind: state.tab, page, limit: 24 });
    if (state.tab === 'events' && state.eventType !== 'all') params.set('type', state.eventType);
    return params;
  }

  // Highlight the nav link matching this page (kind + event type).
  function syncNav() {
    const type = state.eventType === 'all' ? '' : state.eventType;
    document.querySelectorAll('.top-nav a[data-kind]').forEach((a) => {
      const active = a.dataset.kind === state.tab && (a.dataset.type || '') === type;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  async function loadFirstPage() {
    state.page = 1;
    gridEl.textContent = '';
    emptyEl.hidden = true;
    moreBtn.hidden = true;
    try {
      const data = await getJSON(`/api/explore?${tabParams(1)}`);
      const frag = document.createDocumentFragment();
      data.items.forEach((item, i) => frag.append(resourceCard(item, i)));
      gridEl.append(frag);
      state.hasMore = data.hasMore;
      state.page = 2;
      moreBtn.hidden = !data.hasMore;
      emptyEl.hidden = data.items.length > 0;
    } catch (err) {
      console.error('explore load failed', err);
      emptyEl.hidden = false;
    }
  }

  async function loadMore() {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    moreBtn.disabled = true;
    moreBtn.textContent = 'Loading…';
    try {
      const data = await getJSON(`/api/explore?${tabParams(state.page)}`);
      const frag = document.createDocumentFragment();
      data.items.forEach((item, i) => frag.append(resourceCard(item, i)));
      gridEl.append(frag);
      state.hasMore = data.hasMore;
      state.page += 1;
      moreBtn.hidden = !data.hasMore;
    } catch (err) {
      console.error('explore load-more failed', err);
    } finally {
      state.loading = false;
      moreBtn.disabled = false;
      moreBtn.textContent = 'Load More';
    }
  }
  moreBtn.addEventListener('click', loadMore);

  /* ---------- Boot ---------- */
  function boot() {
    const query = new URLSearchParams(location.search);
    const wanted = query.get('kind');
    if (KINDS.some((k) => k.key === wanted)) state.tab = wanted;
    const type = query.get('type');
    if (state.tab === 'events' && EVENT_TYPE_LABELS[type]) state.eventType = type;

    const label = state.eventType !== 'all'
      ? EVENT_TYPE_LABELS[state.eventType]
      : KINDS.find((k) => k.key === state.tab).label;
    titleEl.textContent = label;
    document.title = `${label} — AI & Tech News`;
    syncNav();
    loadFirstPage();
  }
  boot();
})();
