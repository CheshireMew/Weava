(() => {
  const track = (name) => document.dispatchEvent(new CustomEvent('weava:analytics', { detail: { name } }));
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
    notify('链接已复制'); track('article:copy');
  };
  const moreButtons = [...document.querySelectorAll('[data-article-action="more"]')];
  const menuFor = button => document.getElementById(button.getAttribute('aria-controls'));
  const closeMenu = (button, restoreFocus = false) => {
    menuFor(button).hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus();
  };
  const openMenu = (button, last = false) => {
    moreButtons.forEach(other => { if (other !== button) closeMenu(other); });
    const menu = menuFor(button);
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    (last ? items.at(-1) : items[0])?.focus();
  };
  moreButtons.forEach(button => {
    const wrap = button.closest('.nl-more-wrap');
    wrap.addEventListener('focusout', event => {
      if (!wrap.contains(event.relatedTarget)) closeMenu(button);
    });
    wrap.addEventListener('keydown', event => {
      const menu = menuFor(button);
      if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault(); event.stopPropagation(); closeMenu(button, true);
      } else if (event.key === 'Tab' && !menu.hidden) {
        closeMenu(button, true);
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        if (menu.hidden || event.target === button) { openMenu(button, event.key === 'ArrowUp' || event.key === 'End'); return; }
        const items = [...menu.querySelectorAll('[role="menuitem"]')];
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    });
  });
  document.querySelectorAll('[data-article-action]').forEach((button) => button.addEventListener('click', async () => {
    const action = button.dataset.articleAction;
    const parentMenu = button.closest('.nl-more-menu');
    if (parentMenu) closeMenu(moreButtons.find(trigger => menuFor(trigger) === parentMenu), true);
    try {
      if (action === 'copy') await copyLink();
      if (action === 'share') {
        if (navigator.share) {
          try { await navigator.share({ title: document.querySelector('h1')?.textContent || document.title, url: canonical }); track('article:share'); }
          catch (error) { if (error.name !== 'AbortError') await copyLink(); }
        } else await copyLink();
      }
      if (action === 'print') window.print();
      if (action === 'more') { if (menuFor(button).hidden) openMenu(button); else closeMenu(button, true); }
    } catch (error) { notify(error.message); }
  }));
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.nl-more-wrap')) moreButtons.forEach(button => closeMenu(button));
  });
  const entryId = document.body.dataset.articleId;
  if (!entryId) return;
  const form = document.querySelector('[data-comment-form]');
  const list = document.querySelector('[data-comment-list]');
  if (!form || !list) return;
  const message = form.querySelector('[data-comment-message]');
  let messageTimer;
  const showMessage = text => { clearTimeout(messageTimer); message.textContent = text; if (text) messageTimer = setTimeout(() => { message.textContent = ''; }, 4500); };
  const noun = document.querySelector('[data-comment-noun]')?.dataset.commentNoun || '评论';
  const sort = document.querySelector('[data-comment-sort]');
  const more = document.querySelector('[data-load-comments]');
  const likeButtons = [...document.querySelectorAll('[data-article-action="like"]')];
  let liked = false, page = 1, summaryVersion = 0, likeBusy = false;
  let readerInitialized = false, readerPending;
  const commentLikePending = new Set();
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
      column.className = 'nl-comment-content';
      author.textContent = item.author; time.dateTime = item.createdAt;
      time.textContent = new Intl.DateTimeFormat(document.body.dataset.language || 'zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: document.body.dataset.timezone || 'Asia/Shanghai' }).format(new Date(item.createdAt));
      body.textContent = item.body; header.append(author);
      if(item.isOwner){const badge=document.createElement('span');badge.className='comment-owner';badge.textContent='站主';header.append(badge);}
      header.append(time); column.append(header);
      if(item.replyTo){const target=document.createElement('small');target.textContent='回复 '+item.replyTo;column.append(target);}
      column.append(body);
      const actions = document.createElement('div'); actions.className = 'nl-comment-actions';
      const like = document.createElement('button'); like.type = 'button'; like.dataset.commentLike = item.id; like.setAttribute('aria-label', '点赞 ' + item.author + ' 的评论'); like.setAttribute('aria-pressed', String(!!item.liked)); like.disabled = commentLikePending.has(item.id);
      like.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M7 10H3v11h4M7 10l5-8c2 0 3 2 2 4l-1 4h6a2 2 0 0 1 2 2l-2 7a3 3 0 0 1-3 2H7Z" /></svg>';
      const label = document.createElement('span'), count = document.createElement('span'); label.dataset.commentLikeLabel = ''; label.textContent = item.liked ? '已赞' : '点赞'; count.dataset.commentLikeCount = ''; count.textContent = item.likes || 0; count.hidden = !item.likes; like.append(label, count); actions.append(like);
      if(form.dataset.closed!=='true'){const button=document.createElement('button');button.type='button';button.textContent='回复';button.dataset.replyId=item.id;button.dataset.replyAuthor=item.author;actions.append(button);}
      column.append(actions);
      article.append(avatar, column); list.append(article);
    });
    more.hidden = !data.hasMore;
    document.querySelector('[data-empty-comments]').hidden = list.childElementCount > 0;
  };
  async function loadComments(append = false) {
    const version = ++summaryVersion, next = append ? page + 1 : 1;
    const data = await api('engagement?id=' + encodeURIComponent(entryId) + '&page=' + next + '&sort=' + sort.value);
    readerInitialized = true;
    if (version === summaryVersion) { page = next; render(data, append); }
  }
  function ensureReader() {
    if (readerInitialized) return Promise.resolve();
    if (!readerPending) readerPending = loadComments().finally(() => { readerPending = null; });
    return readerPending;
  }
  ensureReader().catch((error) => notify(error.message));
  list.addEventListener('click', async event => {
    const button = event.target.closest('[data-comment-like]');
    if (!button || !list.contains(button)) return;
    const id = button.dataset.commentLike;
    if (commentLikePending.has(id)) return;
    commentLikePending.add(id); button.disabled = true;
    try {
      await ensureReader();
      const current = [...list.querySelectorAll('[data-comment-like]')].find(item => item.dataset.commentLike === id) || button;
      const result = await api('comment-like', { commentId: id, liked: current.getAttribute('aria-pressed') !== 'true' });
      list.querySelectorAll('[data-comment-like]').forEach(item => {
        if (item.dataset.commentLike !== id) return;
        item.setAttribute('aria-pressed', String(result.liked));
        item.querySelector('[data-comment-like-label]').textContent = result.liked ? '已赞' : '点赞';
        const count = item.querySelector('[data-comment-like-count]'); count.textContent = result.likes; count.hidden = !result.likes;
      });
    } catch (error) { notify(error.message); }
    finally { commentLikePending.delete(id); list.querySelectorAll('[data-comment-like]').forEach(item => { if (item.dataset.commentLike === id) item.disabled = false; }); }
  });
  likeButtons.forEach((button) => button.addEventListener('click', async () => {
    if (likeBusy) return;
    likeBusy = true; likeButtons.forEach((item) => { item.disabled = true; });
    try { await ensureReader(); ++summaryVersion; const data = await api('like', { liked: !liked }); updateCounts(data); track(data.liked ? 'article:like' : 'article:unlike'); }
    catch (error) { notify(error.message); }
    finally { likeBusy = false; likeButtons.forEach((item) => { item.disabled = false; }); }
  }));
  sort.addEventListener('change', () => loadComments().catch((error) => notify(error.message)));
  more.addEventListener('click', () => loadComments(true).catch((error) => notify(error.message)));
  if (form.dataset.closed === 'true') return;
  const authorInput = form.elements.author, bodyInput = form.elements.body, captchaInput = form.elements.captcha;
  const parentInput=form.elements.parentId,replyTarget=form.querySelector('[data-reply-target]');
  const cancelReply=()=>{parentInput.value='';replyTarget.hidden=true;bodyInput.placeholder='写下你的'+noun+'…';submit.textContent='发布'+noun;};
  form.querySelector('[data-cancel-reply]').addEventListener('click',cancelReply);
  list.addEventListener('click',event=>{const button=event.target.closest('[data-reply-id]');if(!button)return;parentInput.value=button.dataset.replyId;replyTarget.querySelector('span').textContent='回复 '+button.dataset.replyAuthor;replyTarget.hidden=false;bodyInput.placeholder='回复 '+button.dataset.replyAuthor+'…';submit.textContent='发布回复';bodyInput.focus();});
  const captchaRow = form.querySelector('[data-captcha-row]'), captchaImage = form.querySelector('[data-captcha-image]'), refresh = form.querySelector('[data-refresh-captcha]'), submit = form.querySelector('[type="submit"]');
  let captchaId = '', captchaPending, posting = false, clientId = '', signature = '';
  try { authorInput.value = localStorage.getItem('weava-comment-author') || ''; } catch {}
  const loadCaptcha = () => {
    if (captchaPending) return captchaPending;
    refresh.disabled = true; captchaRow.hidden = false; captchaInput.disabled = true; submit.disabled = true;
    captchaPending = ensureReader().then(() => api('comment-captcha', {})).then((data) => {
      captchaId = data.id; captchaImage.src = data.image; captchaInput.value = ''; captchaInput.disabled = false;
    }).catch((error) => { captchaId = ''; showMessage(error.message); }).finally(() => { captchaPending = null; refresh.disabled = false; submit.disabled = posting || !captchaId; });
    return captchaPending;
  };
  form.addEventListener('focusin', () => { if (!captchaId && !posting) loadCaptcha(); });
  refresh.addEventListener('click', () => { captchaId = ''; showMessage(''); loadCaptcha(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (posting) return;
    if (!captchaId) { await loadCaptcha(); captchaInput.focus(); return; }
    if (!form.reportValidity()) return;
    const submitted = { author: authorInput.value, body: bodyInput.value, parentId: parentInput.value };
    const current = JSON.stringify([submitted.author.trim(), submitted.body.trim(), submitted.parentId]);
    if (!clientId || signature !== current) { signature = current; clientId = crypto.randomUUID(); }
    posting = true; submit.disabled = true; submit.textContent = '发布中…'; showMessage('');
    try {
      const data = await api('comment', { ...submitted, parentId: submitted.parentId || null, captchaId, captcha: captchaInput.value, clientId });
      track('article:comment');
      ++summaryVersion; page = 1; sort.value = 'latest'; render(data, false);
      try { localStorage.setItem('weava-comment-author', authorInput.value.trim()); } catch {}
      const unchanged = authorInput.value === submitted.author && bodyInput.value === submitted.body && parentInput.value === submitted.parentId;
      if (unchanged) { bodyInput.value = ''; cancelReply(); }
      captchaInput.value = ''; clientId = ''; signature = ''; captchaId = ''; captchaRow.hidden = true; captchaInput.disabled = true; showMessage(data.comment?.status === 'pending' ? noun+'已提交，等待审核' : noun+'已发布');
      if (!unchanged) await loadCaptcha();
    } catch (error) { showMessage(error.message); captchaId = ''; await loadCaptcha(); }
    finally { posting = false; submit.disabled = !captchaId; submit.textContent = parentInput.value ? '发布回复' : '发布'+noun; }
  });
})();
