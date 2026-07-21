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

  // Jobs field chips — keys match meta.field set by the backend classifier.
  const JOB_FIELDS = [
    { key: 'latest', label: 'Latest' },
    { key: 'ai', label: 'AI & ML' },
    { key: 'data', label: 'Data' },
    { key: 'engineering', label: 'Engineering' },
    { key: 'devops', label: 'DevOps & Cloud' },
    { key: 'security', label: 'Security' },
    { key: 'product', label: 'Product & Design' },
  ];

  // Topic chips for courses / events / hackathons (server tags meta.category).
  const CATEGORIES = ['Generative AI', 'LLMs', 'AI Agents', 'Prompt Engineering', 'RAG', 'Machine Learning', 'Deep Learning', 'NLP', 'Computer Vision', 'MLOps', 'Data Science', 'Python', 'SQL', 'Cloud', 'Cybersecurity', 'DevOps'];

  const state = {
    tab: 'jobs', eventType: 'all', jobField: 'latest',
    q: '', mode: '', city: '', exp: '', category: 'all', free: '',
    page: 1, hasMore: false, loading: false, sig: null,
  };

  const $ = (id) => document.getElementById(id);
  const titleEl = $('explore-title');
  const toolsEl = $('explore-tools');
  const chipsEl = $('filter-chips');
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

  function timeAgo(iso) {
    if (!iso) return 'Recently';
    const days = Math.max(0, (Date.now() - new Date(iso).getTime()) / 864e5);
    if (Number.isNaN(days)) return 'Recently';
    if (days < 1) return 'Today';
    if (days < 2) return 'Yesterday';
    if (days < 30) return `${Math.floor(days)}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /* ---------- Card ---------- */
  function wireClickable(card, item) {
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    card.setAttribute('aria-label', `${item.title} — open on ${item.source || 'source'}`);
    card.addEventListener('click', (e) => { if (!e.target.closest('a')) openLink(item); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === card) openLink(item); });
  }

  function cardTitle(item) {
    const title = el('h3', 'card-title');
    const link = el('a', null, item.title);
    link.href = item.link;
    link.target = '_blank';
    link.rel = 'noopener external';
    link.tabIndex = -1; // card itself is the tab stop
    link.addEventListener('click', (e) => { e.preventDefault(); openLink(item); });
    title.append(link);
    return title;
  }

  // Minimal job card: logo · company / designation / salary · type · mode · place.
  // Full details live at the source.
  function jobCard(item, i) {
    const card = el('article', 'news-card job-card');
    card.style.setProperty('--i', Math.min(i, 11));
    const info = el('div', 'card-info');
    const m = item.meta || {};

    const head = el('div', 'job-head');
    const initial = el('span', 'job-logo job-logo-ph', (m.company || item.source || '?').slice(0, 1).toUpperCase());
    if (item.image) {
      const logo = el('img', 'job-logo');
      logo.src = item.image;
      logo.alt = '';
      logo.loading = 'lazy';
      logo.addEventListener('error', () => logo.replaceWith(initial));
      head.append(logo);
    } else {
      head.append(initial);
    }
    head.append(el('span', 'job-company', m.company || item.source));
    info.append(head);

    info.append(cardTitle(item));

    // Salary, experience, posted-time always shown — "not disclosed" when
    // the employer didn't publish it (we never invent numbers).
    const row = el('div', 'res-badges');
    row.append(el('span', m.salary ? 'res-badge free' : 'res-badge muted', m.salary || 'Salary not disclosed'));
    row.append(el('span', m.experience ? 'res-badge' : 'res-badge muted', m.experience || 'Exp not listed'));
    row.append(el('span', 'res-badge', timeAgo(item.date)));
    if (m.type) row.append(el('span', 'res-badge', m.type));
    if (m.mode) row.append(el('span', 'res-badge', m.mode));
    if (m.location) row.append(el('span', 'res-badge', m.location));
    info.append(row);

    card.append(info);
    wireClickable(card, item);
    return card;
  }

  function badgesFor(item) {
    const out = [];
    const m = item.meta || {};
    if (item.kind === 'paper' && m.authors) out.push({ text: m.authors });
    if (item.kind === 'event') {
      if (m.type) out.push({ text: m.type.charAt(0).toUpperCase() + m.type.slice(1) });
      if (m.category) out.push({ text: m.category });
      if (item.date) out.push({ text: new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) });
      if (m.city) out.push({ text: m.city });
      if (m.mode) out.push({ text: m.mode === 'in-person' ? 'In-person' : 'Online' });
      if (m.free) out.push({ text: 'Free', free: true });
    }
    if (item.kind === 'course') {
      if (m.category) out.push({ text: m.category });
      if (m.level) out.push({ text: m.level });
      if (m.duration) out.push({ text: m.duration });
      out.push(m.free ? { text: 'Free', free: true } : { text: 'Paid' });
      if (m.cert) out.push({ text: 'Certificate', free: true });
    }
    if (item.kind === 'hackathon') {
      if (m.category) out.push({ text: m.category });
      if (m.deadline) out.push({ text: m.deadline });
      if (m.mode) out.push({ text: m.mode });
      if (m.prize) out.push({ text: m.prize });
    }
    return out;
  }

  function resourceCard(item, i) {
    if (item.kind === 'job') return jobCard(item, i);

    const card = el('article', 'news-card');
    card.style.setProperty('--i', Math.min(i, 11));

    if (item.image) {
      const media = el('div', 'res-media');
      const img = el('img');
      img.src = item.image;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => media.remove());
      media.append(img);
      card.append(media);
    }

    const info = el('div', 'card-info');
    info.append(cardTitle(item));

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
    wireClickable(card, item);
    return card;
  }

  function tabParams(page) {
    const params = new URLSearchParams({ kind: state.tab, page, limit: 24 });
    if (state.tab === 'events' && state.eventType !== 'all') params.set('type', state.eventType);
    if (state.tab === 'jobs' && state.jobField !== 'latest') params.set('type', state.jobField);
    if (state.q) params.set('q', state.q);
    if (state.tab === 'jobs') {
      if (state.mode) params.set('mode', state.mode);
      if (state.city) params.set('city', state.city);
      if (state.exp) params.set('exp', state.exp);
    } else {
      if (state.category !== 'all') params.set('category', state.category);
      if (state.free) params.set('free', state.free);
      if (state.tab === 'events' && state.mode) params.set('mode', state.mode);
    }
    return params;
  }

  /* ---------- Search + filters toolbar ---------- */
  function makeSelect(label, options, onChange) {
    const sel = el('select', 'explore-select');
    sel.setAttribute('aria-label', label);
    for (const [value, text] of options) {
      const opt = el('option', null, text);
      opt.value = value;
      sel.append(opt);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  let searchTimer = null;
  function renderTools() {
    toolsEl.textContent = '';

    const search = el('input', 'explore-search');
    search.type = 'search';
    search.placeholder = state.tab === 'jobs' ? 'Search role, company, skill…' : 'Search…';
    search.setAttribute('aria-label', 'Search');
    search.value = state.q;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.q = search.value.trim();
        loadFirstPage();
      }, 350);
    });
    toolsEl.append(search);

    if (state.tab === 'jobs') {
      toolsEl.append(
        makeSelect('Work mode', [['', 'Mode: Any'], ['Remote', 'Remote'], ['Hybrid', 'Hybrid'], ['On-site', 'On-site']],
          (v) => { state.mode = v; loadFirstPage(); }),
        makeSelect('Experience', [['', 'Exp: Any'], ['0-2', '0–2 yrs'], ['3-5', '3–5 yrs'], ['6+', '6+ yrs']],
          (v) => { state.exp = v; loadFirstPage(); }),
        makeSelect('City', [['', 'City: Any'], ['bengaluru', 'Bengaluru'], ['mumbai', 'Mumbai'], ['hyderabad', 'Hyderabad'], ['pune', 'Pune'], ['chennai', 'Chennai'], ['delhi', 'Delhi NCR']],
          (v) => { state.city = v; loadFirstPage(); }),
      );
    } else if (state.tab === 'courses') {
      toolsEl.append(
        makeSelect('Price', [['', 'Price: Any'], ['free', 'Free'], ['paid', 'Paid']],
          (v) => { state.free = v; loadFirstPage(); }),
      );
    } else if (state.tab === 'events') {
      toolsEl.append(
        makeSelect('Mode', [['', 'Mode: Any'], ['online', 'Online'], ['offline', 'In-person']],
          (v) => { state.mode = v; loadFirstPage(); }),
      );
    }
  }

  // Chips row: jobs get field chips; courses/events/hackathons get topic chips.
  function renderChipsRow() {
    chipsEl.textContent = '';
    chipsEl.hidden = false;
    if (state.tab === 'jobs') {
      for (const { key, label } of JOB_FIELDS) {
        const chip = el('button', 'filter-chip', label);
        chip.type = 'button';
        chip.setAttribute('aria-pressed', key === state.jobField ? 'true' : 'false');
        if (key === state.jobField) chip.classList.add('active');
        chip.addEventListener('click', () => {
          if (state.jobField === key) return;
          state.jobField = key;
          history.replaceState(null, '', key === 'latest' ? '?kind=jobs' : `?kind=jobs&type=${key}`);
          renderChipsRow();
          loadFirstPage();
        });
        chipsEl.append(chip);
      }
      return;
    }
    for (const name of ['all', ...CATEGORIES]) {
      const chip = el('button', 'filter-chip', name === 'all' ? 'All' : name);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', name === state.category ? 'true' : 'false');
      if (name === state.category) chip.classList.add('active');
      chip.addEventListener('click', () => {
        if (state.category === name) return;
        state.category = name;
        renderChipsRow();
        loadFirstPage();
      });
      chipsEl.append(chip);
    }
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

  function renderPage1(data) {
    gridEl.textContent = '';
    const frag = document.createDocumentFragment();
    data.items.forEach((item, i) => frag.append(resourceCard(item, i)));
    gridEl.append(frag);
    state.hasMore = data.hasMore;
    state.page = 2;
    state.sig = data.items.map((x) => x.id).join(',');
    moreBtn.hidden = !data.hasMore;
    emptyEl.hidden = data.items.length > 0;
  }

  async function loadFirstPage() {
    state.page = 1;
    gridEl.textContent = '';
    emptyEl.hidden = true;
    moreBtn.hidden = true;
    try {
      renderPage1(await getJSON(`/api/explore?${tabParams(1)}`));
    } catch (err) {
      console.error('explore load failed', err);
      emptyEl.hidden = false;
    }
  }

  /* ---------- Live updates: poll every minute ----------
     Refresh in place only while the reader hasn't engaged (top of page, no
     load-more) — never re-render under someone reading. */
  const POLL_MS = 60 * 1000;
  async function poll() {
    if (document.hidden || window.scrollY > 200 || state.page > 2 || state.loading) return;
    try {
      const data = await getJSON(`/api/explore?${tabParams(1)}`);
      const sig = data.items.map((x) => x.id).join(',');
      if (sig !== state.sig) renderPage1(data);
    } catch { /* transient — next tick retries */ }
  }
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

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
    if (state.tab === 'jobs' && JOB_FIELDS.some((f) => f.key === type)) state.jobField = type;

    const label = state.eventType !== 'all'
      ? EVENT_TYPE_LABELS[state.eventType]
      : KINDS.find((k) => k.key === state.tab).label;
    titleEl.textContent = label;
    document.title = `${label} — AI & Tech News`;
    syncNav();
    renderTools();
    renderChipsRow();
    loadFirstPage();
  }
  boot();
})();
