import {afterEach,expect,it} from 'vitest';
import {Window} from 'happy-dom';
import {readFileSync} from 'node:fs';
import {entrySchema,defaultSettings,siteText,siteDictionary,type Release} from '@weava/contracts';
import {renderEntryTemplate} from '../packages/core/src/render.ts';
import {localizeCodeControls} from '../packages/core/src/public-locale.ts';
const windows:Window[]=[];
afterEach(async()=>{for(const window of windows.splice(0))await window.happyDOM.close();});
it.each(['en','ja','zh-TW','zh-CN'])('translates fixed controls while keeping authored Chinese text in %s',language=>{
  const entry={...entrySchema.parse({id:'article',kind:'content',title:'作者的中文标题',path:'/article/',document:{version:1,format:'markdown',source:'中文正文和 `中文代码`'}}),html:'<p>中文正文和中文代码</p>',revisionId:1,modifiedAt:'2026-11-01T00:00:00Z'};
  const release:Release={id:'r',label:'test',createdAt:entry.modifiedAt,settings:{...defaultSettings,language},types:[],entries:[entry]};
  const output=renderEntryTemplate(entry,release);expect(output).toContain('中文正文和中文代码');
  const source='<p>复制代码</p><button data-copy-code>复制代码</button>';
  expect(localizeCodeControls(source,language)).toBe('<p>复制代码</p><button data-copy-code>'+siteText(language,'复制代码')+'</button>');
  expect(siteText(language,'共 {count} 项结果',{count:23})).toContain('23');
});
it.each(['en','ja','zh-TW'])('uses the same dictionary for code controls and dynamic comment actions in %s',async language=>{
  const window=new Window({url:'https://site.test/article/'});windows.push(window);
  window.document.body.dataset.language=language;
  window.document.body.innerHTML='<script id="weava-i18n" type="application/json">'+JSON.stringify(siteDictionary(language))+'</script><div class="code-block"><button data-copy-code>复制代码</button><pre data-code-source="'+encodeURIComponent('中文代码')+'"></pre></div><div data-comment-list></div><select data-comment-sort></select><button data-load-comments></button><p data-empty-comments></p><form data-comment-form><input name="author"><textarea name="body"></textarea><input name="parentId"><div data-reply-target hidden><span></span><button type="button" data-cancel-reply></button></div><div data-captcha-row hidden><img data-captcha-image><input name="captcha"><button type="button" data-refresh-captcha></button></div><button type="submit"></button><p data-comment-message></p></form>';
  window.document.body.dataset.articleId='article';
  window.fetch=(async()=>new window.Response(JSON.stringify({items:[{id:'comment',author:'中文读者',body:'中文留言',createdAt:'2026-11-01T00:00:00Z',likes:0}],hasMore:false,likes:0,comments:1,liked:false}),{status:200})) as any;
  window.eval(readFileSync('apps/web/public/weava-code.js','utf8'));window.eval(readFileSync('apps/web/public/weava-article.js','utf8'));
  await new Promise(resolve=>setTimeout(resolve,10));
  expect(window.document.querySelector('[data-copy-code]')?.textContent).toBe(siteText(language,'复制代码'));
  expect(window.document.querySelector('[data-reply-id]')?.textContent).toBe(siteText(language,'回复'));
  expect(window.document.querySelector('[data-comment-list]')?.textContent).toContain('中文留言');
});
