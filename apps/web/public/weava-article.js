(() => {
  const toc = document.querySelector('[data-toc]');
  if (toc) {
    const handle = toc.querySelector('[data-toc-toggle]');
    const panel = toc.querySelector('.nl-toc-panel');
    const backdrop = toc.querySelector('.nl-toc-backdrop');
    const setOpen = (open) => {
      toc.dataset.open = String(open);
      panel.hidden = !open;
      backdrop.hidden = !open;
      handle.setAttribute('aria-expanded', String(open));
      handle.setAttribute('aria-label', open ? '收起文章目录' : '展开文章目录');
    };
    handle.addEventListener('click', () => setOpen(toc.dataset.open !== 'true'));
    toc.querySelectorAll('[data-toc-close]').forEach((button) => button.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setOpen(false); });
    const links = [...toc.querySelectorAll('[data-heading-id]')];
    const headings = links.map((link) => document.getElementById(link.dataset.headingId));
    links.forEach((link, index) => link.addEventListener('click', (event) => {
      const target = headings[index];
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      history.replaceState(null, '', '#' + encodeURIComponent(target.id));
      if (innerWidth < 1280) setOpen(false);
    }));
    let pending = false, active = -1;
    const update = () => {
      pending = false;
      let next = 0;
      headings.forEach((heading, index) => { if (heading && heading.getBoundingClientRect().top <= 150) next = index; });
      if (next === active) return;
      active = next;
      links.forEach((link, index) => { if (index === next) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); });
      const nav = panel.querySelector('nav'), link = links[next];
      if (toc.dataset.open === 'true' && link) {
        const delta = link.getBoundingClientRect().top - nav.getBoundingClientRect().top;
        if (delta < 0 || delta > nav.clientHeight - 35) nav.scrollTop += delta - nav.clientHeight / 2;
      }
    };
    addEventListener('scroll', () => { if (!pending) { pending = true; requestAnimationFrame(update); } }, { passive: true });
    setOpen(toc.dataset.open === 'true'); update();
  }
  document.querySelectorAll('[data-recommend-sort]').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('[data-recommend-sort]').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
    document.querySelectorAll('[data-recommend-list]').forEach((list) => { list.hidden = list.dataset.recommendList !== button.dataset.recommendSort; });
  }));
  let toastTimer;
  const notify = (text) => {
    let toast = document.querySelector('.nl-article-toast');
    if (!toast) { toast = document.createElement('div'); toast.className = 'nl-article-toast'; toast.setAttribute('role', 'status'); document.body.append(toast); }
    toast.textContent = text; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 2800);
  };
  const canonical = document.body.dataset.canonical || location.href;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(canonical); }
    catch {
      const input = document.createElement('textarea'); input.value = canonical; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select();
      const copied = document.execCommand('copy'); input.remove(); if (!copied) throw new Error('复制失败，请从地址栏复制链接。');
    }
    notify('链接已复制');
  };
  document.querySelectorAll('[data-article-action]').forEach((button) => button.addEventListener('click', async () => {
    const action = button.dataset.articleAction;
    try {
      if (action === 'copy') await copyLink();
      if (action === 'share') {
        if (navigator.share) {
          try { await navigator.share({ title: document.querySelector('h1')?.textContent || document.title, url: canonical }); }
          catch (error) { if (error.name !== 'AbortError') await copyLink(); }
        } else await copyLink();
      }
      if (action === 'print') window.print();
      if (action === 'more') { const menu = document.getElementById(button.getAttribute('aria-controls')); menu.hidden = !menu.hidden; button.setAttribute('aria-expanded', String(!menu.hidden)); }
    } catch (error) { notify(error.message); }
  }));
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.nl-more-wrap')) document.querySelectorAll('.nl-more-menu').forEach((menu) => { menu.hidden = true; menu.previousElementSibling.setAttribute('aria-expanded', 'false'); });
  });
  const entryId = document.body.dataset.articleId;
  if (!entryId) return;
  const form = document.querySelector('[data-comment-form]');
  const list = document.querySelector('[data-comment-list]');
  const message = form.querySelector('[data-comment-message]');
  const sort = document.querySelector('[data-comment-sort]');
  const more = document.querySelector('[data-load-comments]');
  const likeButtons = [...document.querySelectorAll('[data-article-action="like"]')];
  let liked = false, page = 1, summaryVersion = 0, likeBusy = false;
  async function api(action, data) {
    const response = await fetch('/api/v1/' + action, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify({ ...data, id: entryId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '操作失败，请稍后重试。');
    return result;
  }
  const updateCounts = (data) => {
    if (typeof data.liked === 'boolean') liked = data.liked;
    document.querySelectorAll('[data-like-count]').forEach((node) => { node.textContent = data.likes; node.hidden = !data.likes; });
    document.querySelectorAll('[data-comment-count]').forEach((node) => { node.textContent = data.comments; node.hidden = !data.comments; });
    likeButtons.forEach((button) => { button.setAttribute('aria-pressed', String(liked)); button.disabled = likeBusy; });
  };
  const render = (data, append) => {
    updateCounts(data);
    if (!append) list.replaceChildren();
    data.items.forEach((item) => {
      const article = document.createElement('article'); article.className = 'nl-comment'; article.dataset.commentId = item.id;
      const avatar = document.createElement('span'); avatar.className = 'nl-comment-avatar'; avatar.textContent = [...item.author][0]; avatar.setAttribute('aria-hidden', 'true');
      const column = document.createElement('div'), header = document.createElement('header'), author = document.createElement('strong'), time = document.createElement('time'), body = document.createElement('p');
      author.textContent = item.author; time.dateTime = item.createdAt;
      time.textContent = new Intl.DateTimeFormat(document.body.dataset.language || 'zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: document.body.dataset.timezone || 'Asia/Shanghai' }).format(new Date(item.createdAt));
      body.textContent = item.body; header.append(author, time); column.append(header, body); article.append(avatar, column); list.append(article);
    });
    more.hidden = !data.hasMore;
    document.querySelector('[data-empty-comments]').hidden = list.childElementCount > 0;
  };
  async function loadComments(append = false) {
    const version = ++summaryVersion, next = append ? page + 1 : 1;
    const data = await api('engagement?id=' + encodeURIComponent(entryId) + '&page=' + next + '&sort=' + sort.value);
    if (version === summaryVersion) { page = next; render(data, append); }
  }
  const readerReady = loadComments().catch((error) => { notify(error.message); throw error; });
  readerReady.catch(() => {});
  likeButtons.forEach((button) => button.addEventListener('click', async () => {
    if (likeBusy) return;
    likeBusy = true; likeButtons.forEach((item) => { item.disabled = true; }); ++summaryVersion;
    try { await readerReady; updateCounts(await api('like', { liked: !liked })); }
    catch (error) { notify(error.message); }
    finally { likeBusy = false; likeButtons.forEach((item) => { item.disabled = false; }); }
  }));
  sort.addEventListener('change', () => loadComments().catch((error) => notify(error.message)));
  more.addEventListener('click', () => loadComments(true).catch((error) => notify(error.message)));
  const authorInput = form.elements.author, bodyInput = form.elements.body, captchaInput = form.elements.captcha;
  const captchaRow = form.querySelector('[data-captcha-row]'), captchaImage = form.querySelector('[data-captcha-image]'), refresh = form.querySelector('[data-refresh-captcha]'), submit = form.querySelector('[type="submit"]');
  let captchaId = '', captchaPending, posting = false, clientId = '', signature = '';
  try { authorInput.value = localStorage.getItem('weava-comment-author') || ''; } catch {}
  const loadCaptcha = () => {
    if (captchaPending) return captchaPending;
    refresh.disabled = true; captchaRow.hidden = false; captchaInput.disabled = true; submit.disabled = true;
    captchaPending = readerReady.then(() => api('comment-captcha', {})).then((data) => {
      captchaId = data.id; captchaImage.src = data.image; captchaInput.value = ''; captchaInput.disabled = false;
    }).catch((error) => { captchaId = ''; message.textContent = error.message; }).finally(() => { captchaPending = null; refresh.disabled = false; submit.disabled = posting || !captchaId; });
    return captchaPending;
  };
  form.addEventListener('focusin', () => { if (!captchaId && !posting) loadCaptcha(); });
  refresh.addEventListener('click', () => { captchaId = ''; message.textContent = ''; loadCaptcha(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (posting) return;
    if (!captchaId) { await loadCaptcha(); captchaInput.focus(); return; }
    if (!form.reportValidity()) return;
    const current = JSON.stringify([authorInput.value.trim(), bodyInput.value.trim()]);
    if (!clientId || signature !== current) { signature = current; clientId = crypto.randomUUID(); }
    posting = true; submit.disabled = true; submit.textContent = '发布中…'; message.textContent = '';
    try {
      const data = await api('comment', { author: authorInput.value, body: bodyInput.value, captchaId, captcha: captchaInput.value, clientId });
      ++summaryVersion; page = 1; sort.value = 'latest'; render(data, false);
      try { localStorage.setItem('weava-comment-author', authorInput.value.trim()); } catch {}
      bodyInput.value = ''; captchaInput.value = ''; clientId = ''; signature = ''; captchaId = ''; captchaRow.hidden = true; captchaInput.disabled = true; message.textContent = '评论已发布';
    } catch (error) { message.textContent = error.message; captchaId = ''; await loadCaptcha(); }
    finally { posting = false; submit.disabled = false; submit.textContent = '发布评论'; }
  });
})();
