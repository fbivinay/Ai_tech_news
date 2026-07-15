/* AI & Tech News frontend: renders the hero + card feed, infinite scroll,
   category filtering, external-link notice, and a light-first theme toggle. */

(() => {
  const state = {
    page: 1,
    category: 'All',
    loading: false,
    hasMore: true,
  };

  const $ = (id) => document.getElementById(id);
  const feedEl = $('feed');
  const heroEl = $('hero');
  const loaderEl = $('loader');
  const endNoteEl = $('end-note');
  const emptyNoteEl = $('empty-note');
  const toastEl = $('toast');

  /* ---------- Theme (light by default) ---------- */

  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') document.documentElement.dataset.theme = 'dark';

  $('theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? '' : 'dark';
    localStorage.setItem('theme', dark ? 'light' : 'dark');
  });

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
    link.append(el('span', null, label), el('span', null, '→'));
    link.addEventListener('click', () => showExternalNotice(item.sourceName));
    return link;
  }

  /* ---------- Rendering ---------- */

  function renderHero(item) {
    heroEl.textContent = '';
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
      img.src = item.image;
      img.alt = '';
      img.loading = 'eager';
      img.addEventListener('error', () => media.remove());
      media.append(img);
      heroEl.append(media);
    }

    makeClickable(heroEl, item);
  }

  function renderCard(item) {
    const card = el('article', 'article-card');

    if (item.image) {
      const thumb = el('div', 'card-thumb');
      const img = el('img');
      img.src = item.image;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => thumb.remove());
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

  /* ---------- Data loading ---------- */

  async function loadPage() {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    loaderEl.hidden = false;
    endNoteEl.hidden = true;
    emptyNoteEl.hidden = true;

    try {
      const params = new URLSearchParams({ page: state.page, limit: 12 });
      if (state.category !== 'All') params.set('category', state.category);
      const res = await fetch(`/api/feed?${params}`);
      const data = await res.json();

      if (state.page === 1) {
        feedEl.textContent = '';
        renderHero(data.hero);
        if (state.category !== 'All') heroEl.hidden = true;
      }

      const fragment = document.createDocumentFragment();
      for (const item of data.items) fragment.append(renderCard(item));
      feedEl.append(fragment);

      state.hasMore = data.hasMore;
      state.page += 1;

      if (!data.hasMore) {
        (feedEl.children.length === 0 ? emptyNoteEl : endNoteEl).hidden = false;
      }
    } catch (err) {
      console.error('feed load failed', err);
    } finally {
      state.loading = false;
      loaderEl.hidden = true;
    }
  }

  /* ---------- Categories ---------- */

  async function loadCategories() {
    try {
      const res = await fetch('/api/categories');
      const { categories } = await res.json();
      const bar = $('category-bar');
      bar.textContent = '';

      const all = [{ name: 'All' }, ...categories.slice(0, 9)];
      for (const { name } of all) {
        const chip = el('button', 'category-chip', name);
        chip.type = 'button';
        if (name === state.category) chip.classList.add('active');
        chip.addEventListener('click', () => {
          state.category = name;
          state.page = 1;
          state.hasMore = true;
          bar.querySelectorAll('.category-chip').forEach((c) => c.classList.toggle('active', c === chip));
          window.scrollTo({ top: 0 });
          loadPage();
        });
        bar.append(chip);
      }
    } catch (err) {
      console.error('categories load failed', err);
    }
  }

  /* ---------- Infinite scroll ---------- */

  const observer = new IntersectionObserver(
    (entries) => { if (entries[0].isIntersecting) loadPage(); },
    { rootMargin: '600px 0px' },
  );
  observer.observe($('sentinel'));

  /* ---------- Boot ---------- */

  loadCategories();
  loadPage();
})();
