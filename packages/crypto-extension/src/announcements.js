// Official exchange announcements use a same-origin cache service.
(() => {
  'use strict';
  const widget = document.querySelector('[data-announcements]');
  if (!widget) return;
  const compact = widget.dataset.compact === 'true';
  const limit = Number(widget.dataset.limit);
  const expanded = new Set();
  const feeds = new Map();
  const signatures = new Map();
  const panels = Array.from(widget.querySelectorAll('[data-announcement-feed]'));
  const status = widget.querySelector('[data-announcements-status]');
  let loading = false;
  let usedFallback = false;

  const officialUrl = (value, platform) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === (platform === 'binance' ? 'www.binance.com' : 'www.okx.com') && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  };
  const updatedLabel = value => {
    const time = new Date(value);
    return value && Number.isFinite(time.getTime()) ? new Intl.DateTimeFormat('sv-SE', {
      timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false
    }).format(time) : '尚未更新';
  };

  function render(panel, feed, force = false) {
    const stale = feed.stale || !feed.updatedAt || Date.now() - Date.parse(feed.updatedAt) > 30 * 60 * 1000;
    panel.querySelector('[data-feed-status]').textContent = `${!feed.items.length ? '暂时无法获取' : stale ? '上次保存' : '更新于'} ${updatedLabel(feed.updatedAt)}`;
    const signature = JSON.stringify(feed.items);
    if (force || signatures.get(feed.id) !== signature) {
      signatures.set(feed.id, signature);
      const list = panel.querySelector('[data-feed-list]');
      const fragment = document.createDocumentFragment();
      for (const row of feed.items.slice(0, expanded.has(feed.id) ? feed.items.length : limit)) {
        const url = officialUrl(row.url, feed.platform);
        if (!url) continue;
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = url; link.target = '_blank'; link.rel = 'sponsored noopener';
        const title = document.createElement('span'); title.textContent = row.title;
        const arrow = document.createElement('span'); arrow.className = 'announcement-arrow';
        arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
        link.append(title, arrow);
        const time = document.createElement('time'); time.dateTime = row.publishedAt; time.textContent = row.date;
        li.append(link, time); fragment.append(li);
      }
      list.replaceChildren(fragment);
      panel.querySelector('[data-feed-empty]').hidden = !!list.children.length;
    }
    const more = panel.querySelector('[data-feed-more]');
    if (more) {
      more.hidden = feed.items.length <= limit;
      more.textContent = expanded.has(feed.id) ? '收起公告 ↑' : `显示更多公告（共 ${feed.items.length} 条）↓`;
      more.setAttribute('aria-expanded', String(expanded.has(feed.id)));
    }
  }

  function applyFilter(value, updateUrl = false) {
    if (!['all','binance','okx','events'].includes(value)) value = 'all';
    for (const panel of panels) {
      panel.hidden = !(value === 'all' || value === panel.dataset.platform || value === 'events' && panel.dataset.announcementFeed.endsWith('-events'));
    }
    widget.querySelectorAll('[data-announcement-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.announcementFilter === value)));
    if (updateUrl && !compact) {
      const url = new URL(location.href);
      if (value === 'all') url.searchParams.delete('source'); else url.searchParams.set('source', value);
      history.replaceState(null, '', url);
    }
  }
  widget.addEventListener('click', event => {
    const filter = event.target.closest('[data-announcement-filter]');
    if (filter) applyFilter(filter.dataset.announcementFilter, true);
    const button = event.target.closest('[data-feed-more]');
    if (button) {
      const key = button.dataset.feedMore;
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
      const panel = button.closest('[data-announcement-feed]');
      if (feeds.has(key)) render(panel, feeds.get(key), true);
    }
  });
  if (!compact) {
    applyFilter(new URLSearchParams(location.search).get('source') || 'all');
    window.addEventListener('popstate', () => applyFilter(new URLSearchParams(location.search).get('source') || 'all'));
    if (location.hash && panels.some(panel => '#' + panel.id === location.hash)) applyFilter('all');
  }

  async function get(url) {
    const response = await fetch(url, {cache:'no-store', signal:AbortSignal.timeout(8000)});
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error('Feed unavailable');
    const data = await response.json();
    if (data.version !== 1 || !Array.isArray(data.feeds) || panels.some(panel => !data.feeds.some(feed => feed.id === panel.dataset.announcementFeed && Array.isArray(feed.items)))) throw new Error('Invalid feed');
    return data;
  }
  async function refresh() {
    if (loading || document.hidden) return;
    loading = true;
    try {
      let data;
      let live = true;
      try { data = await get('/api/announcements'); }
      catch {
        live = false;
        if (usedFallback) throw new Error('Feed unavailable');
        data = await get('/exchange-announcements.json');
        usedFallback = true;
      }
      for (const panel of panels) {
        const feed = data.feeds.find(row => row.id === panel.dataset.announcementFeed);
        feeds.set(feed.id, feed); render(panel, feed);
      }
      status.hidden = live;
      status.textContent = live ? '' : '实时更新暂不可用，当前显示已保存的公告。';
    } catch {
      status.hidden = false;
      status.textContent = '暂时无法检查更新，已保留当前公告。';
    } finally { loading = false; }
  }
  refresh();
  setInterval(refresh, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
