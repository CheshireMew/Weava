(() => {
  const storage = (name) => {
    try {
      const target = window[name];
      const key = 'weava-check';
      target.setItem(key, '1');
      target.removeItem(key);
      return target;
    } catch {
      return null;
    }
  };
  const persistent = storage('localStorage'),
    local = storage('sessionStorage');
  const params = new URLSearchParams(location.search);
  if (
    navigator.doNotTrack === '1' ||
    persistent?.getItem('weava-exclude') === '1' ||
    params.get('analytics') === 'off'
  )
    return;
  if (window.__weavaAnalytics) return;
  window.__weavaAnalytics = true;
  const path = location.pathname,
    now = () => Date.now(),
    uuid = () => crypto.randomUUID();
  let visitor = persistent?.getItem('weava-visitor') || uuid();
  try {
    persistent?.setItem('weava-visitor', visitor);
  } catch {}
  let session = '',
    viewed = false,
    viewId = '',
    activeMs = 0,
    tick = now(),
    maxScroll = 0;
  const key = 'weava-events-v2';
  let queue = [];
  try {
    const stored = JSON.parse(local?.getItem(key) || '[]');
    if (Array.isArray(stored)) queue = stored.slice(-100);
  } catch {}
  const save = () => {
    try {
      local?.setItem(key, JSON.stringify(queue.slice(-100)));
    } catch {}
  };
  const campaign = {
    source: params.get('utm_source') || '',
    medium: params.get('utm_medium') || '',
    campaign: params.get('utm_campaign') || '',
  };
  const readSession = () => {
    try {
      return JSON.parse(persistent?.getItem('weava-session') || 'null');
    } catch {
      return null;
    }
  };
  function sessionForPage() {
    const previous = readSession();
    const id =
      previous && now() - previous.ts < 1800000
        ? previous.id
        : persistent
          ? uuid()
          : session || uuid();
    try {
      persistent?.setItem('weava-session', JSON.stringify({ id, ts: now() }));
    } catch {}
    return id;
  }
  let sending = false,
    wasVisible = document.visibilityState === 'visible';
  function batch() {
    const items = [];
    let bytes = 2;
    for (const item of queue.slice(0, 100)) {
      const size = new TextEncoder().encode(JSON.stringify(item)).length + 1;
      if (bytes + size > 48000) break;
      items.push(item);
      bytes += size;
    }
    return items;
  }
  async function send() {
    if (sending || !queue.length) return;
    sending = true;
    const items = batch();
    let acknowledged = false;
    try {
      const res = await fetch('/api/v1/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items),
        keepalive: true,
      });
      if (res.ok) {
        acknowledged = true;
        const ids = new Set(items.map((e) => e.id));
        queue = queue.filter((e) => !ids.has(e.id));
        save();
      }
    } catch {
    } finally {
      sending = false;
    }
    if (queue.length && acknowledged) setTimeout(send, 100);
  }
  function add(kind, extra = {}, transmit = true) {
    const event = {
      id: uuid(),
      ts: new Date().toISOString(),
      kind,
      path,
      visitor,
      session,
      releaseId: document.body.dataset.release || '',
      referrer: document.referrer,
      language: navigator.language,
      hints: { touchPoints: navigator.maxTouchPoints || 0 },
      campaign,
      ...extra,
    };
    const previousPulse =
      kind === 'pulse'
        ? queue.findIndex((item) => item.kind === 'pulse' && item.viewId === extra.viewId)
        : -1;
    if (previousPulse >= 0) queue[previousPulse] = event;
    else queue.push(event);
    if (queue.length > 100) queue = queue.slice(-100);
    save();
    if (transmit) send();
    return event.id;
  }
  function view() {
    if (document.visibilityState !== 'visible') return;
    const current = sessionForPage();
    if (!viewed || current !== session) {
      session = current;
      viewed = true;
      activeMs = 0;
      maxScroll = 0;
      tick = now();
      viewId = add('view');
    }
  }
  function measure() {
    const at = now();
    if (viewed && wasVisible) activeMs += Math.min(at - tick, 35000);
    tick = at;
    wasVisible = document.visibilityState === 'visible';
  }
  function pulse(closed = false, beacon = false) {
    if (!viewed) return;
    measure();
    const height = Math.max(1, document.documentElement.scrollHeight);
    maxScroll = Math.max(
      maxScroll,
      Math.min(100, Math.round(((scrollY + innerHeight) / height) * 100)),
    );
    add('pulse', { viewId, activeMs: Math.round(activeMs), scroll: maxScroll, closed }, !beacon);
    if (beacon) {
      const items = batch();
      // A queued beacon is not a server acknowledgement. Keep the events for the
      // next page to retry, and use keepalive to finish this request after navigation.
      fetch('/api/v1/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items),
        keepalive: true,
      })
        .then((response) => {
          if (!response.ok) return;
          const ids = new Set(items.map((e) => e.id));
          queue = queue.filter((e) => !ids.has(e.id));
          save();
        })
        .catch(() => {});
    }
  }
  view();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      tick = now();
      view();
      pulse();
    } else pulse(true, true);
  });
  window.addEventListener('pagehide', () => pulse(true, true));
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      tick = now();
      view();
      pulse();
    }
  });
  window.addEventListener('blur', () => pulse());
  document.addEventListener(
    'scroll',
    () => {
      const height = Math.max(1, document.documentElement.scrollHeight);
      maxScroll = Math.max(
        maxScroll,
        Math.min(100, Math.round(((scrollY + innerHeight) / height) * 100)),
      );
    },
    { passive: true },
  );
  document.addEventListener('weava:analytics', (event) => {
    const name = event.detail?.name;
    if (viewed && typeof name === 'string' && /^[\w.:-]{1,80}$/.test(name)) {
      view();
      add('event', { label: name });
    }
  });
  document.addEventListener('click', (event) => {
    const a = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!a || !viewed) return;
    let target;
    try {
      target = new URL(a.href);
    } catch {
      return;
    }
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(target.protocol)) return;
    if (
      target.origin === location.origin &&
      target.pathname === location.pathname &&
      target.search === location.search &&
      target.hash
    )
      return;
    view();
    add('click', {
      url: a.href.slice(0, 4000),
      label: (a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 200),
      zone: a.closest('header') ? 'header' : a.closest('footer') ? 'footer' : 'body',
    });
  });
  window.addEventListener('online', send);
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      view();
      pulse();
    } else send();
  }, 30000);
})();
