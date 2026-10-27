(() => {
  if (
    navigator.doNotTrack === '1' ||
    localStorage.getItem('weava-exclude') === '1' ||
    location.search.includes('analytics=off')
  )
    return;
  const path = location.pathname;
  let visitor, session;
  try {
    visitor = localStorage.getItem('weava-visitor') || crypto.randomUUID();
    localStorage.setItem('weava-visitor', visitor);
    const old = JSON.parse(localStorage.getItem('weava-session') || 'null');
    session = old && Date.now() - old.ts < 1800000 ? old.id : crypto.randomUUID();
    localStorage.setItem('weava-session', JSON.stringify({ id: session, ts: Date.now() }));
  } catch {
    visitor = crypto.randomUUID();
    session = crypto.randomUUID();
  }
  let queue = [];
  const key = 'weava-events';
  try {
    queue = JSON.parse(localStorage.getItem(key) || '[]');
  } catch {}
  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify(queue.slice(-100)));
    } catch {}
  };
  let sending = false;
  async function send() {
    if (sending || !queue.length) return;
    sending = true;
    const batch = queue.slice(0, 100);
    try {
      const res = await fetch('/api/v1/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
        keepalive: true,
      });
      if (res.ok) {
        const ids = new Set(batch.map((e) => e.id));
        queue = queue.filter((e) => !ids.has(e.id));
        save();
      }
    } catch {
    } finally {
      sending = false;
    }
  }
  function add(kind, extra = {}) {
    queue.push({
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      kind,
      path,
      visitor,
      session,
      releaseId: document.body.dataset.release || '',
      referrer: document.referrer,
      ...extra,
    });
    save();
    send();
  }
  let viewed = false;
  function view() {
    if (!viewed && document.visibilityState === 'visible') {
      viewed = true;
      add('view');
    }
  }
  view();
  document.addEventListener('visibilitychange', view);
  document.addEventListener('click', (event) => {
    const a = event.target.closest('a[href]');
    if (a && !a.hash && !a.href.startsWith(location.href + '#'))
      add('click', {
        url: a.href,
        label: a.textContent.trim().slice(0, 200),
        zone: a.closest('header') ? 'header' : a.closest('footer') ? 'footer' : 'body',
      });
  });
  window.addEventListener('online', send);
  setInterval(send, 30000);
})();
