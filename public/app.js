/* AI & Tech News frontend.
   Fast by design: skeleton screens while fetching, an instant repaint from
   sessionStorage on repeat visits (then silent revalidation), early infinite-
   scroll prefetch, and GPU-friendly entrance/hover animations. */

(() => {
  const state = {
    page: 1,
    category: 'All',
    loading: false,
    hasMore: true,
    firstIds: null, // fingerprint of what's on screen, for silent revalidation
  };

  const CACHE_KEY = 'feed-cache-v1';
  const CACHE_MAX_AGE_MS = 15 * 60 * 1000;

  const $ = (id) => document.getElementById(id);
  const feedEl = $('feed');
  const heroEl = $('hero');
  const loaderEl = $('loader');
  const endNoteEl = $('end-note');
  const emptyNoteEl = $('empty-note');
  const toastEl = $('toast');
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

  // Fade images in once their pixels have arrived (no pop-in).
  function fadeInImage(img, container) {
    img.addEventListener('load', () => img.classList.add('loaded'));
    img.addEventListener('error', () => container.remove());
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
      if (event.target.closest('a')) return; // real links handle themselves
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

  function tagRow(item) {
    const row = el('div', 'tag-row');
    row.append(el('span', 'chip cat', item.category));
    for (const company of (item.companies || []).slice(0, 3)) {
      row.append(el('span', 'chip', company));
    }
    if (item.region && item.region !== 'Global') row.append(el('span', 'chip', `📍 ${item.region}`));
    return row;
  }

  function readLink(item, label) {
    const link = el('a', 'read-link');
    link.href = item.link;
    link.target = '_blank';
    link.rel = 'noopener external';
    link.append(el('span', null, label), el('span', 'arrow', '→'));
    link.addEventListener('click', () => showExternalNotice(item.sourceName));
    return link;
  }

  /* ---------- Skeleton screens ---------- */

  function skeletonHero() {
    const wrap = el('div', 'skeleton-hero');
    const body = el('div', 'sk-body');
    body.append(el('div', 'sk sk-kicker'));
    body.append(el('div', 'sk sk-title'), el('div', 'sk sk-title short'));
    body.append(el('div', 'sk sk-line'), el('div', 'sk sk-line'), el('div', 'sk sk-line short'));
    body.append(el('div', 'sk sk-meta'));
    wrap.append(body, el('div', 'sk sk-media'));
    return wrap;
  }

  function skeletonCard() {
    const card = el('div', 'skeleton-card');
    card.append(
      el('div', 'sk sk-thumb'),
      el('div', 'sk sk-title'),
      el('div', 'sk sk-line'),
      el('div', 'sk sk-line short'),
      el('div', 'sk sk-meta'),
    );
    return card;
  }

  function showSkeletons({ withHero }) {
    if (withHero) {
      heroEl.hidden = true;
      heroEl.textContent = '';
      heroEl.insertAdjacentElement('beforebegin', skeletonHero());
    }
    feedEl.textContent = '';
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 6; i++) fragment.append(skeletonCard());
    feedEl.append(fragment);
  }

  function clearSkeletons() {
    document.querySelectorAll('.skeleton-hero').forEach((n) => n.remove());
    feedEl.querySelectorAll('.skeleton-card').forEach((n) => n.remove());
  }

  /* ---------- Rendering ---------- */

  function renderHero(item) {
    heroEl.textContent = '';
    heroEl.classList.remove('switching');
    if (!item) { heroEl.hidden = true; return; }
    heroEl.hidden = false;

    const body = el('div', 'hero-body');
    body.append(el('div', 'kicker', '🔥 Top Story'));

    const title = el('h1', 'hero-title');
    const titleLink = el('a', null, item.title);
    titleLink.href = item.link;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener external';
    title.append(titleLink);
    body.append(title);

    body.append(el('p', 'hero-summary', item.summary));
    body.append(metaRow(item));
    body.append(tagRow(item));
    body.append(readLink(item, 'Read Full Article'));
    body.append(el('span', 'ext-hint', '↗ External link — opens the original source'));

    heroEl.append(body);

    if (item.image) {
      const media = el('div', 'hero-media');
      const img = el('img');
      img.alt = '';
      img.loading = 'eager';
      img.fetchPriority = 'high';
      fadeInImage(img, media);
      img.src = item.image;
      media.append(img);
      heroEl.append(media);
    }

    makeClickable(heroEl, item);
  }

  function renderCard(item, indexInBatch) {
    const card = el('article', 'article-card');
    card.style.setProperty('--i', Math.min(indexInBatch, 11));

    if (item.image) {
      const thumb = el('div', 'card-thumb');
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      fadeInImage(img, thumb);
      img.src = item.image;
      thumb.append(img);
      card.append(thumb);
    }

    const title = el('h3', 'card-title');
    const titleLink = el('a', null, item.title);
    titleLink.href = item.link;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener external';
    title.append(titleLink);

    card.append(title, el('p', 'card-summary', item.summary), metaRow(item), tagRow(item), readLink(item, 'Read'));
    card.append(el('span', 'ext-hint', '↗ Opens original source'));
    makeClickable(card, item);
    return card;
  }

  function renderFirstPage(data) {
    clearSkeletons();
    feedEl.textContent = '';
    feedEl.classList.remove('switching');
    renderHero(data.hero);
    if (state.category !== 'All') heroEl.hidden = true;

    const fragment = document.createDocumentFragment();
    data.items.forEach((item, i) => fragment.append(renderCard(item, i)));
    feedEl.append(fragment);

    state.firstIds = fingerprint(data);
    state.hasMore = data.hasMore;
    state.page = 2;

    endNoteEl.hidden = true;
    emptyNoteEl.hidden = true;
    if (!data.hasMore) {
      (feedEl.children.length === 0 ? emptyNoteEl : endNoteEl).hidden = false;
    }
  }

  function fingerprint(data) {
    return [data.hero?.id, ...data.items.map((i) => i.id)].join(',');
  }

  /* ---------- Data loading ---------- */

  async function fetchFeed(page) {
    const params = new URLSearchParams({ page, limit: 12 });
    if (state.category !== 'All') params.set('category', state.category);
    const res = await fetch(`/api/feed?${params}`);
    if (!res.ok) throw new Error(`feed ${res.status}`);
    return res.json();
  }

  // Initial load: paint the cached copy instantly if we have one, then
  // fetch fresh data and repaint only if the news actually changed.
  async function boot() {
    let painted = false;

    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.at < CACHE_MAX_AGE_MS) {
        renderFirstPage(cached.data);
        renderCategories(cached.categories);
        painted = true;
      }
    } catch { /* corrupt cache — ignore */ }

    if (!painted) showSkeletons({ withHero: true });

    try {
      const [data, categories] = await Promise.all([
        fetchFeed(1),
        fetch('/api/categories').then((r) => r.json()).then((j) => j.categories),
      ]);
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data, categories }));

      if (!painted || fingerprint(data) !== state.firstIds) {
        renderFirstPage(data);
        renderCategories(categories);
      } else {
        // Same stories — just refresh pagination state silently.
        state.hasMore = data.hasMore;
      }
    } catch (err) {
      console.error('feed load failed', err);
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
      data.items.forEach((item, i) => fragment.append(renderCard(item, i)));
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

    // Quick fade-out, then skeletons while the new category loads.
    feedEl.classList.add('switching');
    heroEl.classList.add('switching');
    window.scrollTo({ top: 0 });
    await new Promise((r) => setTimeout(r, 160));

    heroEl.hidden = true;
    showSkeletons({ withHero: name === 'All' });

    try {
      const data = await fetchFeed(1);
      renderFirstPage(data);
    } catch (err) {
      console.error('category load failed', err);
      clearSkeletons();
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

  /* ---------- Infinite scroll (prefetches well before the bottom) ---------- */

  const observer = new IntersectionObserver(
    (entries) => { if (entries[0].isIntersecting) loadNextPage(); },
    { rootMargin: '1200px 0px' },
  );
  observer.observe($('sentinel'));

  /* ---------- Boot ---------- */

  boot();
})();
