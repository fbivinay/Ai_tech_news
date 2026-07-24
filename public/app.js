/* Update Bro! frontend — Netflix-style homepage.
   Billboard hero + horizontal rails + "Latest" grid with Load More button.
   Fast by design: one /api/home request per load, skeleton screens, instant
   repaint from localStorage on repeat visits, 60-second live polling with a
   "New stories" pill (the page never reshuffles itself), and explicit
   load-more pagination. */

(() => {
  const state = {
    page: 1,
    category: 'All',
    loading: false,
    hasMore: true,
    rowsFingerprint: null,
    lastRefresh: null,
  };

  const CACHE_KEY = 'home-cache-v3';
  const CACHE_MAX_AGE_MS = 30 * 60 * 1000;
  const POLL_MS = 60 * 1000;

  const $ = (id) => document.getElementById(id);
  const billboardEl = $('billboard');
  const railsEl = $('rails');
  const feedEl = $('feed');
  const endNoteEl = $('end-note');
  const emptyNoteEl = $('empty-note');
  const toastEl = $('toast');
  const newPillEl = $('new-pill');
  const loadMoreBtn = $('load-more-btn');
  const headerEl = document.querySelector('.site-header');

  /* ---------- Theme (light by default) ---------- */

  if (localStorage.getItem('theme') === 'dark') document.documentElement.dataset.theme = 'dark';

  $('theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? '' : 'dark';
    localStorage.setItem('theme', dark ? 'light' : 'dark');
  });

  /* ---------- Analytics (only loaded after "Accept All") ---------- */

  const GA_MEASUREMENT_ID = 'G-RBN5HV40NY';

  function loadAnalytics() {
    if (window.__gaLoaded) return;
    window.__gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID);

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(script);
  }

  /* ---------- Cookie/storage consent gate (blocks the site until chosen) ---------- */

  const CONSENT_KEY = 'cookie-consent'; // 'all' | 'necessary'

  if (localStorage.getItem(CONSENT_KEY) === 'all') loadAnalytics();

  function initConsentGate() {
    if (localStorage.getItem(CONSENT_KEY)) {
      maybeShowNotifPrompt();
      return;
    }

    const gate = $('consent-gate');
    const focusable = [...gate.querySelectorAll('a[href], button')];

    document.body.style.overflow = 'hidden';
    gate.hidden = false;
    requestAnimationFrame(() => gate.classList.add('show'));
    focusable[0].focus();

    function choose(value) {
      localStorage.setItem(CONSENT_KEY, value);
      if (value === 'all') loadAnalytics();
      gate.classList.remove('show');
      document.body.style.overflow = '';
      setTimeout(() => { gate.hidden = true; }, 250);
      maybeShowNotifPrompt();
    }

    // Trap focus on the gate's own controls (privacy link + the two
    // buttons) — nothing behind the gate is reachable until a choice is made.
    gate.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const i = focusable.indexOf(document.activeElement);
      const nextIndex = event.shiftKey
        ? (i <= 0 ? focusable.length - 1 : i - 1)
        : (i === focusable.length - 1 ? 0 : i + 1);
      focusable[nextIndex].focus();
    });

    $('consent-necessary').addEventListener('click', () => choose('necessary'));
    $('consent-all').addEventListener('click', () => choose('all'));
  }

  initConsentGate();

  /* ---------- Notification permission prompt (asked after the cookie choice,
     and again on every visit/refresh until the visitor accepts or blocks it)
     + firing a native notification when a fresh top story lands ---------- */

  function maybeShowNotifPrompt() {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return; // already granted or blocked

    const prompt = $('notif-prompt');
    prompt.hidden = false;
    requestAnimationFrame(() => prompt.classList.add('show'));

    function dismiss() {
      prompt.classList.remove('show');
      setTimeout(() => { prompt.hidden = true; }, 250);
    }

    $('notif-enable').addEventListener('click', () => {
      Notification.requestPermission().finally(dismiss);
    }, { once: true });
    $('notif-dismiss').addEventListener('click', dismiss, { once: true });
  }

  // Foreground-only: fires while this tab is open, piggybacking on the
  // existing 60s poll below. No service worker / push subscription needed.
  function notifyTopStory(home) {
    if (Notification.permission !== 'granted') return;
    const item = home.hero;
    if (!item) return;
    const notification = new Notification(item.title, {
      body: item.summary || '',
      icon: '/logo.png',
      tag: 'top-news',
    });
    notification.onclick = () => {
      window.focus();
      window.open(item.link, '_blank', 'noopener');
      notification.close();
    };
  }

  /* ---------- Header shadow on scroll ---------- */

  let scrollTicking = false;
  window.addEventListener('scroll', () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      headerEl.classList.toggle('scrolled', window.scrollY > 8);
      scrollTicking = false;
    });
  }, { passive: true });

  /* ---------- Helpers ---------- */

  function timeAgo(iso) {
    const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = seconds / 60;
    if (minutes < 60) return `${Math.floor(minutes)} min ago`;
    const hours = minutes / 60;
    if (hours < 24) return `${Math.floor(hours)} hour${hours >= 2 ? 's' : ''} ago`;
    const days = hours / 24;
    if (days < 7) return `${Math.floor(days)} day${days >= 2 ? 's' : ''} ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function logoUrl(domain) {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Publisher images are hotlinked originals: often multi-MB, sometimes
  // behind referrer-based hotlink blocks, sometimes plain http (which the
  // browser blocks on an https page). Route them through Vercel's image
  // optimizer — fetched server-side, resized + recompressed to webp/avif
  // (far under 500 KB), cached at the edge. Off on localhost, where the
  // optimizer endpoint doesn't exist.
  const IMG_OPT = !['localhost', '127.0.0.1'].includes(location.hostname);
  function imgSrc(url, width) {
    if (!IMG_OPT || !/^https?:/i.test(url)) return url;
    return `/_vercel/image?url=${encodeURIComponent(url)}&w=${width}&q=75`;
  }

  function setImage(img, url, width, onFail) {
    img.addEventListener('load', () => img.classList.add('loaded'));
    img.addEventListener('error', () => {
      // Optimizer couldn't fetch this one (bot-blocking CDN, dead link…):
      // retry the raw publisher URL once before giving up.
      if (img.src !== url && /^https:/i.test(url)) { img.src = url; return; }
      onFail();
    });
    img.src = imgSrc(url, width);
    if (img.complete && img.naturalWidth > 0) img.classList.add('loaded');
  }

  let toastTimer = null;
  function showExternalNotice(sourceName) {
    $('toast-dest').textContent = `Opening the full article on ${sourceName}`;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => { toastEl.hidden = true; }, 250);
    }, 2600);
  }

  function openArticle(item) {
    // Plain new-tab navigation to the original publisher — they get the visit.
    showExternalNotice(item.sourceName);
    window.open(item.link, '_blank', 'noopener');
  }

  function makeClickable(node, item) {
    node.addEventListener('click', (event) => {
      if (event.target.closest('a')) return;
      openArticle(item);
    });
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target === node) openArticle(item);
    });
    node.tabIndex = 0;
    node.setAttribute('role', 'link');
    node.setAttribute('aria-label', `${item.title} — read full article on ${item.sourceName}`);
  }

  function metaRow(item) {
    const row = el('div', 'meta-row');
    const logo = el('img', 'source-logo');
    logo.src = logoUrl(item.sourceDomain);
    logo.alt = '';
    logo.loading = 'lazy';
    logo.addEventListener('error', () => logo.remove());
    row.append(
      logo,
      el('span', 'source-name', item.sourceName),
      el('span', 'dot'),
      el('span', null, timeAgo(item.publishedAt)),
    );
    return row;
  }

  /* ---------- Billboard ---------- */

  function renderBillboard(item) {
    billboardEl.textContent = '';
    billboardEl.className = 'billboard';
    if (!item) { billboardEl.hidden = true; return; }
    billboardEl.hidden = false;

    if (item.image) {
      const bg = el('div', 'billboard-bg');
      const img = el('img');
      img.alt = '';
      img.fetchPriority = 'high';
      setImage(img, item.image, 1600, () => { bg.remove(); billboardEl.classList.add('no-image'); });
      bg.append(img);
      billboardEl.append(bg);
    } else {
      billboardEl.classList.add('no-image');
    }
    billboardEl.append(el('div', 'billboard-scrim'));

    const content = el('div', 'billboard-content');
    content.append(el('span', 'kicker', '🔥 Top Story'));

    const title = el('h1', 'billboard-title');
    const titleLink = el('a', null, item.title);
    titleLink.href = item.link;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener external';
    title.append(titleLink);
    content.append(title);

    content.append(el('p', 'billboard-summary', item.summary));
    content.append(metaRow(item));

    const tags = el('div', 'tag-row');
    tags.append(el('span', 'chip cat', item.category));
    for (const company of (item.companies || []).slice(0, 3)) tags.append(el('span', 'chip', company));
    if (item.region && item.region !== 'Global') tags.append(el('span', 'chip', `📍 ${item.region}`));
    content.append(tags);

    const actions = el('div', 'billboard-actions');
    const btn = el('a', 'btn-primary');
    btn.href = item.link;
    btn.target = '_blank';
    btn.rel = 'noopener external';
    btn.append(el('span', 'play', '▶'), el('span', null, 'Read Full Article'));
    btn.addEventListener('click', () => showExternalNotice(item.sourceName));
    actions.append(btn, el('span', 'ext-hint', '↗ Opens the original source'));
    content.append(actions);

    billboardEl.append(content);
    makeClickable(billboardEl, item);
  }

  /* ---------- Cards ---------- */

  function cardMedia(item) {
    const media = el('div', 'card-media');

    if (item.image) {
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      setImage(img, item.image, 480, () => { img.remove(); media.prepend(placeholder()); });
      media.append(img);
    } else {
      media.append(placeholder());
    }

    const overlay = el('div', 'media-overlay');
    overlay.append(el('p', null, item.summary));
    media.append(overlay);
    return media;

    function placeholder() {
      const ph = el('div', 'media-ph');
      ph.append(el('span', null, (item.sourceName || '?').slice(0, 1).toUpperCase()));
      return ph;
    }
  }

  function newsCard(item, indexInBatch, rank = null) {
    const card = el('article', 'news-card');
    card.style.setProperty('--i', Math.min(indexInBatch, 11));

    if (rank != null) {
      card.classList.add('ranked');
      card.append(el('span', 'rank', String(rank)));
    }

    card.append(cardMedia(item));

    const info = el('div', 'card-info');
    const title = el('h3', 'card-title');
    const titleLink = el('a', null, item.title);
    titleLink.href = item.link;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener external';
    title.append(titleLink);
    info.append(title, metaRow(item));

    const tags = el('div', 'tag-row');
    tags.append(el('span', 'chip cat', item.category));
    if (item.companies?.[0]) tags.append(el('span', 'chip', item.companies[0]));
    info.append(tags);

    card.append(info);
    makeClickable(card, item);
    return card;
  }

  /* ---------- Rails ---------- */

  // Native lazy loading never fetches cards that sit off-screen inside a
  // horizontal track, so swiping a rail used to reveal gray boxes waiting on
  // the network. Pre-warm every image in a rail once the rail itself comes
  // near the viewport.
  let railWarm = null;

  function warmRailImages(railsRoot) {
    railWarm?.disconnect();
    railWarm = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.querySelectorAll('img[loading="lazy"]').forEach((img) => { img.loading = 'eager'; });
        railWarm.unobserve(entry.target);
      }
    }, { rootMargin: '600px 0px' });
    railsRoot.querySelectorAll('.rail').forEach((rail) => railWarm.observe(rail));
  }

  function buildRail(name, items, { ranked = false } = {}) {
    const rail = el('section', 'rail');

    const header = el('div', 'rail-header');
    header.append(el('h2', 'rail-title', name), el('span', 'rail-count', `${items.length} stories`));
    rail.append(header);

    const viewport = el('div', 'rail-viewport');
    const track = el('div', 'rail-track');
    items.forEach((item, i) => track.append(newsCard(item, i, ranked ? i + 1 : null)));

    const prev = el('button', 'rail-arrow prev', '‹');
    const next = el('button', 'rail-arrow next', '›');
    prev.type = next.type = 'button';
    prev.setAttribute('aria-label', `Scroll ${name} back`);
    next.setAttribute('aria-label', `Scroll ${name} forward`);

    const step = () => Math.round(track.clientWidth * 0.85);
    prev.addEventListener('click', () => track.scrollBy({ left: -step() }));
    next.addEventListener('click', () => track.scrollBy({ left: step() }));

    const syncArrows = () => {
      prev.disabled = track.scrollLeft <= 4;
      next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 4;
    };
    track.addEventListener('scroll', syncArrows, { passive: true });
    requestAnimationFrame(syncArrows);

    viewport.append(prev, track, next);
    rail.append(viewport);
    return rail;
  }

  function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function renderRails(data) {
    railsEl.textContent = '';
    if (data.trending?.length) {
      const trendingRail = buildRail('Trending Now', data.trending.slice(0, 10), { ranked: true });
      trendingRail.id = 'section-trending';
      railsEl.append(trendingRail);
    }
    for (const row of data.rows || []) {
      const rail = buildRail(row.name, row.items);
      rail.id = `section-${slugify(row.name)}`;
      railsEl.append(rail);
    }
    warmRailImages(railsEl);
  }

  /* ---------- Section navigation (sticky, with scrollspy) ---------- */

  let sectionSpy = null;

  function renderSectionNav() {
    const nav = $('section-nav');
    nav.textContent = '';

    const sections = [
      { label: 'Top Story', target: billboardEl },
      ...[...railsEl.querySelectorAll('.rail')].map((rail) => ({
        label: rail.querySelector('.rail-title')?.textContent,
        target: rail,
      })),
      { label: 'Latest', target: document.getElementById('latest') },
    ].filter((s) => s.label && s.target && !s.target.hidden);

    const chipByTarget = new Map();
    for (const { label, target } of sections) {
      const chip = el('button', 'section-chip', label);
      chip.type = 'button';
      chip.addEventListener('click', () => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      nav.append(chip);
      chipByTarget.set(target, chip);
    }

    // Highlight the section currently under the header as the user scrolls.
    if (sectionSpy) sectionSpy.disconnect();
    sectionSpy = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          chipByTarget.forEach((chip, target) => chip.classList.toggle('active', target === entry.target));
          const active = chipByTarget.get(entry.target);
          active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }
    }, { rootMargin: '-120px 0px -65% 0px' });
    chipByTarget.forEach((_chip, target) => sectionSpy.observe(target));
  }

  function rowsFingerprint(data) {
    return [data.hero?.id, ...(data.trending || []).map((i) => i.id)].join(',');
  }

  /* ---------- Skeletons ---------- */

  function showSkeletons() {
    billboardEl.hidden = true;

    const bb = el('div', 'skeleton-billboard');
    bb.append(el('div', 'sk sk-kicker'), el('div', 'sk sk-title'), el('div', 'sk sk-title short'),
      el('div', 'sk sk-line'), el('div', 'sk sk-line short'), el('div', 'sk sk-btn'));
    billboardEl.insertAdjacentElement('beforebegin', bb);

    railsEl.textContent = '';
    for (let r = 0; r < 2; r++) {
      const rail = el('div', 'skeleton-rail');
      rail.append(el('div', 'sk sk-rail-title'));
      const cards = el('div', 'sk-cards');
      for (let i = 0; i < 5; i++) {
        const c = el('div', 'sk-card');
        c.append(el('div', 'sk sk-thumb'), el('div', 'sk sk-caption'));
        cards.append(c);
      }
      rail.append(cards);
      railsEl.append(rail);
    }

    feedEl.textContent = '';
    for (let i = 0; i < 8; i++) {
      const c = el('div', 'skeleton-grid-card');
      c.append(el('div', 'sk sk-thumb'), el('div', 'sk sk-caption'), el('div', 'sk sk-caption short'));
      feedEl.append(c);
    }
  }

  function clearSkeletons() {
    document.querySelectorAll('.skeleton-billboard, .skeleton-rail').forEach((n) => n.remove());
    feedEl.querySelectorAll('.skeleton-grid-card').forEach((n) => n.remove());
  }

  /* ---------- Rendering: full home ---------- */

  function renderHome(home) {
    clearSkeletons();
    renderBillboard(home.hero);
    renderRails(home);
    renderCategories(home.categories);
    renderSectionNav();
    state.rowsFingerprint = rowsFingerprint(home);
    state.lastRefresh = home.lastRefresh || null;
    renderGridFirstPage(home.feed);
  }

  // Fresh data arrived while something is already on screen: never yank the
  // page out from under the reader — offer it through the pill instead.
  function offerUpdate(home) {
    newPillEl.classList.add('show');
    newPillEl.onclick = () => {
      newPillEl.classList.remove('show');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      state.category = 'All';
      state.page = 1;
      state.hasMore = true;
      renderHome(home);
    };
  }

  function renderGridFirstPage(data) {
    feedEl.textContent = '';
    feedEl.classList.remove('switching');
    const fragment = document.createDocumentFragment();
    data.items.forEach((item, i) => fragment.append(newsCard(item, i)));
    feedEl.append(fragment);

    state.hasMore = data.hasMore;
    state.page = 2;
    endNoteEl.hidden = true;
    emptyNoteEl.hidden = true;
    loadMoreBtn.hidden = !state.hasMore || feedEl.children.length === 0;
    if (!data.hasMore) (feedEl.children.length === 0 ? emptyNoteEl : endNoteEl).hidden = false;
  }

  /* ---------- Data loading ---------- */

  // A 202 {warming:true} means a fresh deployment is fetching news for the
  // first time — keep the skeletons up and retry until real data arrives.
  async function getJSON(url, { retryWarming = true } = {}) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const res = await fetch(url);
      if (!res.ok && res.status !== 202) throw new Error(`${url} → ${res.status}`);
      const body = await res.json();
      if (!body.warming) return body;
      if (!retryWarming) throw new Error('warming');
      await new Promise((r) => setTimeout(r, 2500));
    }
    throw new Error('server did not warm up in time');
  }

  function fetchFeed(page) {
    const params = new URLSearchParams({ page, limit: 12 });
    if (state.category !== 'All') params.set('category', state.category);
    return getJSON(`/api/feed?${params}`);
  }

  async function boot() {
    let painted = false;

    // Instant paint from the last visit (localStorage survives new tabs).
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.at < CACHE_MAX_AGE_MS) {
        renderHome(cached.home);
        painted = true;
      }
    } catch { /* corrupt cache — ignore */ }

    if (!painted) showSkeletons();

    // One request, one consistent snapshot — no cross-endpoint mismatches.
    // fresh=1 skips the CDN cache and makes the server refresh its feeds
    // first if its data is stale, so the first paint is always the latest.
    try {
      const home = await getJSON('/api/home?fresh=1');
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), home })); } catch { /* quota */ }

      if (!painted) {
        renderHome(home);
      } else if (rowsFingerprint(home) !== state.rowsFingerprint) {
        // The visitor just landed on a repaint of their last visit; swap in
        // the latest news directly unless they've already scrolled into it.
        if (window.scrollY < 400) renderHome(home);
        else offerUpdate(home);
      } else {
        state.hasMore = home.feed.hasMore;
      }
    } catch (err) {
      console.error('boot failed', err);
      clearSkeletons();
      if (!painted) emptyNoteEl.hidden = false;
    }
  }

  async function loadNextPage() {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = '';
    loadMoreBtn.append(el('span', 'spinner'), ' Loading…');

    try {
      const data = await fetchFeed(state.page);
      const fragment = document.createDocumentFragment();
      data.items.forEach((item, i) => fragment.append(newsCard(item, i)));
      feedEl.append(fragment);
      state.hasMore = data.hasMore;
      state.page += 1;
      if (!data.hasMore) {
        loadMoreBtn.hidden = true;
        endNoteEl.hidden = false;
      }
    } catch (err) {
      console.error('feed load failed', err);
    } finally {
      state.loading = false;
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = 'Load More Stories';
    }
  }

  async function switchCategory(name) {
    state.category = name;
    state.page = 1;
    state.hasMore = true;
    state.loading = false;
    endNoteEl.hidden = true;
    emptyNoteEl.hidden = true;
    loadMoreBtn.hidden = true;

    feedEl.classList.add('switching');
    await new Promise((r) => setTimeout(r, 160));

    try {
      const data = await fetchFeed(1);
      renderGridFirstPage(data);
    } catch (err) {
      console.error('category load failed', err);
      emptyNoteEl.hidden = false;
    }
  }

  /* ---------- Categories ---------- */

  function renderCategories(categories) {
    const bar = $('category-bar');
    bar.textContent = '';
    // Fixed taxonomy from the server — same chips, same order, every time.
    const all = [{ name: 'All' }, ...categories];
    for (const { name } of all) {
      const chip = el('button', 'category-chip', name);
      chip.type = 'button';
      if (name === state.category) chip.classList.add('active');
      chip.addEventListener('click', () => {
        if (state.category === name) return;
        bar.querySelectorAll('.category-chip').forEach((c) => c.classList.toggle('active', c === chip));
        switchCategory(name);
      });
      bar.append(chip);
    }
  }

  /* ---------- Live updates: poll every minute ---------- */

  async function poll() {
    if (document.hidden) return;
    try {
      const home = await getJSON('/api/home', { retryWarming: false });
      // The CDN may hand back a copy OLDER than what the fresh boot request
      // painted — never cache or offer a downgrade.
      if (home.lastRefresh && state.lastRefresh && new Date(home.lastRefresh) <= new Date(state.lastRefresh)) return;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), home })); } catch { /* quota */ }
      if (state.rowsFingerprint && rowsFingerprint(home) !== state.rowsFingerprint) {
        offerUpdate(home);
        notifyTopStory(home);
      }
    } catch { /* transient network issue — next tick will retry */ }
  }
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  /* ---------- Load More button ---------- */

  loadMoreBtn.addEventListener('click', loadNextPage);

  /* ---------- Boot ---------- */

  boot();
})();
