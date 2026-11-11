import {afterEach, expect, it} from 'vitest';
import {Window, type HTMLButtonElement as HappyButton} from 'happy-dom';
import {readFileSync} from 'node:fs';

const script = readFileSync('apps/web/public/weava-article.js', 'utf8');
const windows: Window[] = [];
afterEach(async () => { for (const window of windows.splice(0)) await window.happyDOM.close(); });
const comment = {id:'reply', author:'读者', body:'原评论', createdAt:'2026-11-01T00:00:00Z', likes:0};
const summary = {items:[comment], hasMore:false, likes:0, comments:1, liked:false};
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
it('uses the same share action for native sharing and clipboard fallback, with clear completion feedback',async()=>{
 const window=new Window({url:'https://example.test/article/'});windows.push(window);
 window.document.body.innerHTML='<h1>测试文章</h1><button data-article-action="share">分享</button>';
 let copied='';Object.defineProperty(window.navigator,'clipboard',{value:{writeText:async(value:string)=>{copied=value;}}});
 window.eval(script);const share=window.document.querySelector<HappyButton>('[data-article-action="share"]')!;
 share.click();await tick();expect(copied).toBe('https://example.test/article/');expect(window.document.querySelector('[role="status"]')?.textContent).toBe('链接已复制');
 let shared:any;Object.defineProperty(window.navigator,'share',{value:async(value:any)=>{shared=value;}});copied='';share.click();await tick();
 expect(shared).toEqual({title:'测试文章',url:'https://example.test/article/'});expect(copied).toBe('');
});
function fixture(handler: (action:string, body:any) => Promise<unknown>) {
  const window = new Window({url:'https://example.test/article/'}); windows.push(window);
  window.document.body.innerHTML = `<button data-article-action="like"></button><span data-like-count></span><span data-comment-count></span>
    <select data-comment-sort><option value="latest">最新</option><option value="oldest">最早</option></select>
    <div data-comment-list></div><button data-load-comments></button><p data-empty-comments></p>
    <form data-comment-form><input name="author"><textarea name="body"></textarea><input name="parentId">
      <div data-reply-target hidden><span></span><button type="button" data-cancel-reply></button></div>
      <div data-captcha-row hidden><img data-captcha-image><input name="captcha"><button type="button" data-refresh-captcha></button></div>
      <button type="submit"></button><p data-comment-message></p></form>`;
  window.document.body.dataset.articleId = 'article';
  const calls: {action:string;body:any}[] = [];
  window.fetch = (async (url:any, init:any) => {
    const action = String(url).split('/api/v1/')[1], body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({action,body});
    return new window.Response(JSON.stringify(await handler(action,body)), {status:200,headers:{'Content-Type':'application/json'}});
  }) as typeof window.fetch;
  window.eval(script);
  const query = (selector:string) => window.document.querySelector(selector) as any;
  const form = query('form');
  return {window, calls, query, form, submit:() => form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}))};
}

it('retries failed reader initialization once for concurrent captcha and likes, then recovers comment likes', async () => {
  let attempts = 0;
  const f = fixture(async action => {
    if (action.startsWith('engagement')) { if (++attempts === 1) throw new Error('暂时离线'); await tick(); return summary; }
    if (action === 'comment-captcha') return {id:'captcha',image:'data:image/png;base64,'};
    if (action === 'comment-like') return {liked:true,likes:1};
    return {...summary,liked:true,likes:1};
  });
  await tick();
  f.query('[data-refresh-captcha]').click(); f.query('[data-article-action="like"]').click();
  await tick(); await tick();
  expect(attempts).toBe(2);
  expect(f.query('[name=captcha]').disabled).toBe(false);
  expect(f.query('[data-article-action="like"]').getAttribute('aria-pressed')).toBe('true');
  f.query('[data-comment-like]').click(); await tick();
  expect(f.query('[data-comment-like]').getAttribute('aria-pressed')).toBe('true');
});

it('accepts a successful sort reload after initialization failed', async () => {
  let attempts = 0;
  const f = fixture(async action => {
    if (action.startsWith('engagement')) { if (++attempts === 1) throw new Error('离线'); return summary; }
    return {id:'captcha',image:'data:image/png;base64,'};
  });
  await tick();
  f.query('[data-comment-sort]').dispatchEvent(new f.window.Event('change')); await tick();
  f.query('[data-refresh-captcha]').click(); await tick();
  expect(attempts).toBe(2); expect(f.calls.some(call => call.action === 'comment-captcha')).toBe(true);
});

it.each([false,true])('clears only an unchanged submitted draft (new edits: %s)', async changed => {
  let finish!: (value:unknown) => void;
  const posted = new Promise(resolve => { finish = resolve; });
  const f = fixture(async action => {
    if (action === 'comment') return posted;
    if (action === 'comment-captcha') return {id:'captcha',image:'data:image/png;base64,'};
    return summary;
  });
  await tick(); f.query('[data-refresh-captcha]').click(); await tick();
  f.query('[name=author]').value='作者'; f.query('[name=body]').value='第一条'; f.query('[name=captcha]').value='1234';
  f.submit();
  if (changed) {
    f.query('[name=author]').value='新署名'; f.query('[name=body]').value='尚未提交的新内容';
    f.query('[data-reply-id]').click();
  }
  finish({...summary,comment:{status:'approved'}}); await tick(); await tick();
  expect(f.calls.find(call => call.action==='comment')?.body).toMatchObject({author:'作者',body:'第一条',parentId:null});
  expect(f.query('[name=body]').value).toBe(changed?'尚未提交的新内容':'');
  expect(f.query('[name=parentId]').value).toBe(changed?'reply':'');
  expect(f.query('[name=author]').value).toBe(changed?'新署名':'作者');
  if(changed) expect(f.query('[type=submit]').disabled).toBe(false);
});
