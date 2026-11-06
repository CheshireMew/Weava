import {describe,it,expect} from 'vitest';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Site} from '../packages/core/src/site.ts';
import {createContent} from '../packages/core/src/authoring.ts';
import {isNoteType,noteTitle,hasNoteContent,entrySchema} from '../packages/contracts/src/index.ts';
import {notesTimeline,isNote,notesPath,cleanNoteHtml,renderNoteDocument} from '../packages/core/src/notes.ts';
import {entryCover} from '../packages/core/src/entry-cover.ts';
import {newsletterCatalog} from '../packages/core/src/newsletter.ts';
import {queryDrafts} from '../packages/core/src/query.ts';
import {seedStarter} from '../packages/core/src/starters.ts';
import {previewRedirects,saveRedirects} from '../packages/core/src/redirects.ts';
const base='D:/Tools/cache/weava/tasks/notes-20261105';
describe('articles and short notes',()=>{
 it('removes the imported promotion without removing note text, links or media',()=>{
  const body='<div><p>正文<a href="https://example.com/">参考链接</a></p><img src="/media/note.png" alt="图片"></div>',source=body+'<div id="crypto-card-final-v8-pure"><p>创作不易，感谢支持</p><a href="https://binance.com/">注册</a></div>';
  expect(cleanNoteHtml(source)).toBe(body);expect(renderNoteDocument({version:1,format:'html',source})).not.toContain('crypto-card');expect(cleanNoteHtml(body)).toBe(body);
 });
 it('does not generate note covers and accepts text or media while rejecting empty notes',()=>{
  const entry=entrySchema.parse({id:'note',kind:'content',type:'wordpress-moment',title:'笔记',path:'/notes/a/'});
  expect(entryCover(entry)).toBe('');expect(entryCover({...entry,type:'custom-note'},{id:'custom-note',format:'note'})).toBe('');expect(entryCover({...entry,type:'post'})).toContain('/default-covers/');
  expect(hasNoteContent({version:1,format:'html',source:'<p>&nbsp;</p>'})).toBe(false);expect(hasNoteContent({version:1,format:'markdown',source:'![图](/media/a.png)'})).toBe(true);expect(hasNoteContent({version:1,format:'lexical',source:{root:{children:[{type:'image',src:'/media/a.png'}]}}})).toBe(true);
 });
 it('creates a single notes entry and keeps both archive aliases while consolidating existing entrances',()=>{
  const site=new Site(join(base,randomUUID()));try{
   seedStarter(site,'blog','newsletter');expect(notesPath(site.release()!)).toBe('/notes/');expect(site.settings().value.navigation.filter((link:{label:string;url:string})=>link.label==='随笔')).toEqual([{label:'随笔',url:'/notes/'}]);expect(site.store.get('type','note')!.value.pathPrefix).toBe('/notes/');
   const page=site.store.get('entry','notes')!;site.saveEntry({...page.value,path:'/category/think/'},page.revision);site.publish({ids:[page.id]});
   const first=site.store.get('entry','notes')!;site.saveEntry({...first.value,path:'/notes/'},first.revision);site.publish({ids:[first.id]});
   const old=site.saveEntry({...first.value,id:'old-notes',path:'/moments/'},null);site.publish({ids:[old.id]});
   const aliases={items:[{source:'/category/think/',target:'/moments/',entryId:old.id,revision:null}]};const preview=previewRedirects(site,aliases);saveRedirects(site,{...aliases,review:preview.review});site.publish({scope:'routes'});
   site.saveEntry({...old.value,path:'/notes/'},old.revision);site.publish({scope:'entries',ids:[old.id],withdrawIds:[first.id]});
   const release=site.release()!;expect(release.entries.filter(entry=>entry.path==='/notes/')).toHaveLength(1);expect(site.redirect(new URL('https://test.invalid/category/think/'))).toBe('/notes/');expect(site.redirect(new URL('https://test.invalid/moments/'))).toBe('/notes/');
  }finally{site.close();}
 });
 it('recognizes existing imported notes and derives an optional heading from text',()=>{
  expect(isNoteType({id:'wordpress-moment'})).toBe(true);expect(isNoteType({id:'post'})).toBe(false);expect(isNoteType({id:'journal',format:'note'})).toBe(true);
  expect(noteTitle({version:1,format:'markdown',source:'今天随手记下一个想法。\n\n![图片](/media/a.png)'})).toBe('今天随手记下一个想法。');
  expect(noteTitle({version:1,format:'lexical',source:{root:{type:'root',children:[{type:'paragraph',children:[{text:'写点笔记'}]}]}}})).toBe('写点笔记');
 });
 it('separates backend libraries and publishes one timeline with article links and complete notes',()=>{
  const site=new Site(join(base,randomUUID()));try{
   site.saveType({id:'post',label:'文章',fields:[],pathPrefix:'/posts/',template:'article'},null);site.saveType({id:'note',label:'笔记',format:'note',fields:[],pathPrefix:'/moments/',template:'note'},null);
   const article=createContent(site,{kind:'content',type:'post',title:'正式长文'}),note=createContent(site,{kind:'content',type:'note'}),draft=createContent(site,{kind:'content',type:'note'}),privateNote=createContent(site,{kind:'content',type:'note'});
   site.saveEntry({...article.value,status:'published',publishedAt:'2026-11-01T00:00:00Z'},article.revision);site.saveEntry({...note.value,title:'短笔记',status:'published',publishedAt:'2026-11-03T00:00:00Z',document:{version:1,format:'markdown',source:'完整的笔记正文'}},note.revision);site.saveEntry({...privateNote.value,status:'published',visibility:'private'},privateNote.revision);
   const settings=site.settings();site.saveSettings({...settings.value,extensions:{notes:{path:'/moments/'}}},settings.revision);site.publish();
   const release=site.release()!;expect(notesTimeline(release).map(item=>item.id)).toEqual([note.id,article.id]);expect(isNote(notesTimeline(release)[0],release)).toBe(true);expect(newsletterCatalog(release).posts.map(item=>item.id)).toEqual([article.id]);expect(notesPath(release)).toBe('/moments/');
   expect(queryDrafts(site,{kind:'content',format:'article'}).items.map(item=>item.id)).toEqual([article.id]);expect(queryDrafts(site,{kind:'content',format:'note'}).total).toBe(3);
   const edited=site.store.get('entry',note.id)!;site.saveEntry({...edited.value,document:{version:1,format:'markdown',source:'尚未发布的修改'}},edited.revision);expect(notesTimeline(site.release()!)[0].document.source).toBe('完整的笔记正文');expect(notesTimeline(release).some(item=>item.id===draft.id)).toBe(false);
  }finally{site.close();}
 });
});
