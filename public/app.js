/* AI & Tech News frontend — Netflix-style homepage.
   Billboard hero + horizontal rails + infinite "Latest" grid.
   Fast by design: skeleton screens, instant repaint from sessionStorage on
   repeat visits (then silent revalidation), 60-second live polling with a
   "New stories" pill, and early infinite-scroll prefetch. */

(() => {
  const state = {
    page: 1,
    category: 'All',
    loading: false,
    hasMore: true,
    rowsFingerprint: null,
  };

  const CACHE_KEY = 'home-cache-v2';
  const CACHE_MAX_AGE_MS = 10 * 60 * 1000;
  const POLL_MS = 60 * 1000;

  const $ = (id) => document.getElementById(id);
  const billboardEl = $('billboard');
  const railsEl = $('rails');
  const feedEl = $('feed');
  const loaderEl = $('loader');
  const endNoteEl = $('end-note');
  const emptyNoteEl = $('empty-note');
  const toastEl = $('toast');
  const newPillEl = $('new-pill');
  const headerEl = document.querySelector('.site-header');

  /* ---------- Theme (light by default) ---------- */

  if (localStorage.getItem('theme') === 'dark') document.documentElement.dataset.theme = 'dark';

  $('theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? '' : 'dark';
    localStorage.setItem('theme', dark ? 'light' : 'dark');
  });

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

  function fadeInImage(img, onFail) {
    img.addEventListener('load', () => img.classList.add('loaded'));
    img.addEventListener('error', onFail);
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
      fadeInImage(img, () => { bg.remove(); billboardEl.classList.add('no-image'); });
      img.src = item.image;
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
      fadeInImage(img, () => { img.remove(); media.prepend(placeholder()); });
      img.src = item.image;
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

  function renderRails(data) {
    railsEl.textContent = '';
    if (data.trending?.length) railsEl.append(buildRail('Trending Now', data.trending.slice(0, 10), { ranked: true }));
    for (const row of data.rows || []) railsEl.append(buildRail(row.name, row.items));
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

  function renderHome(rows, feed) {
    clearSkeletons();
    renderBillboard(rows.hero);
    renderRails(rows);
    state.rowsFingerprint = rowsFingerprint(rows);
    renderGridFirstPage(feed);
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
    if (!data.hasMore) (feedEl.children.length === 0 ? emptyNoteEl : endNoteEl).hidden = false;
  }

  /* ---------- Data loading ---------- */

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  }

  function fetchFeed(page) {
    const params = new URLSearchParams({ page, limit: 12 });
    if (state.category !== 'All') params.set('category', state.category);
    return getJSON(`/api/feed?${params}`);
  }

  async function boot() {
    let painted = false;

    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.at < CACHE_MAX_AGE_MS) {
        renderHome(cached.rows, cached.feed);
        renderCategories(cached.categories);
        painted = true;
      }
    } catch { /* corrupt cache — ignore */ }

    if (!painted) showSkeletons();

    try {
      const [rows, feed, categories] = await Promise.all([
        getJSON('/api/rows'),
        fetchFeed(1),
        getJSON('/api/categories').then((j) => j.categories),
      ]);
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows, feed, categories }));

      if (!painted || rowsFingerprint(rows) !== state.rowsFingerprint) {
        renderHome(rows, feed);
        renderCategories(categories);
      } else {
        state.hasMore = feed.hasMore;
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
    loaderEl.hidden = false;

    try {
      const data = await fetchFeed(state.page);
      const fragment = document.createDocumentFragment();
      data.items.forEach((item, i) => fragment.append(newsCard(item, i)));
      feedEl.append(fragment);
      state.hasMore = data.hasMore;
      state.page += 1;
      if (!data.hasMore) endNoteEl.hidden = false;
    } catch (err) {
      console.error('feed load failed', err);
    } finally {
      state.loading = false;
      loaderEl.hidden = true;
    }
  }

  async function switchCategory(name) {
    state.category = name;
    state.page = 1;
    state.hasMore = true;
    state.loading = false;
    endNoteEl.hidden = true;
    emptyNoteEl.hidden = true;

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
    const all = [{ name: 'All' }, ...categories.slice(0, 9)];
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
      const rows = await getJSON('/api/rows');
      if (state.rowsFingerprint && rowsFingerprint(rows) !== state.rowsFingerprint) {
        newPillEl.classList.add('show');
        newPillEl.onclick = async () => {
          newPillEl.classList.remove('show');
          window.scrollTo({ top: 0, behavior: 'smooth' });
          state.category = 'All';
          state.page = 1;
          state.hasMore = true;
          const [feed, categories] = await Promise.all([
            fetchFeed(1),
            getJSON('/api/categories').then((j) => j.categories),
          ]);
          renderHome(rows, feed);
          renderCategories(categories);
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows, feed, categories }));
        };
      }
    } catch { /* transient network issue — next tick will retry */ }
  }
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  /* ---------- Infinite scroll ---------- */

  const observer = new IntersectionObserver(
    (entries) => { if (entries[0].isIntersecting) loadNextPage(); },
    { rootMargin: '1200px 0px' },
  );
  observer.observe($('sentinel'));

  /* ---------- Boot ---------- */

  boot();
})();
