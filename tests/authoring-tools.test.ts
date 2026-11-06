import { afterEach, describe, expect, it, vi } from 'vitest';
import * as storage from '../packages/core/src/storage.ts';
import { Site, createContent, saveContentView, contentViews, saveCreationTemplate, creationTemplates, exportSite, importSite, queryDrafts } from '@weava/core';
const sites: Site[] = [], root = 'D:/Tools/cache/weava/tasks/random-permalinks-20261105/authoring-' + Date.now(); let sequence = 0;
const create = () => { const site = new Site(root + '/' + sequence++); sites.push(site); site.saveType({ id: 'note', label: '笔记', pathPrefix: '/notes/', template: 'article', fields: [{ key: 'topic', label: '主题', type: 'select', options: ['写作', '代码'], filterable: true, defaultValue: '写作' }] }, null); return site; };
afterEach(() => {vi.restoreAllMocks();sites.splice(0).forEach((site) => site.close());});
describe('saved authoring tools', () => {
  it('keeps eight hexadecimal characters and retries a collision with another draft',()=>{
    const site=create(),first=createContent(site,{kind:'content',type:'note'});expect(first.value.path).toBe('/notes/'+first.id.slice(0,8)+'/');
    const random=vi.spyOn(storage,'uuid').mockReturnValueOnce((first.id.slice(0,8)+'-aaaa-4aaa-aaaa-aaaaaaaaaaaa') as ReturnType<typeof storage.uuid>).mockReturnValueOnce('abcdef12-bbbb-4bbb-bbbb-bbbbbbbbbbbb');
    const second=createContent(site,{kind:'content',type:'note'});expect(second.value.path).toBe('/notes/abcdef12/');expect(random).toHaveBeenCalledTimes(2);
    expect(site.store.get('entry',first.id)?.value.path).toBe(first.value.path);
  });
  it('does not reuse a published old address or an existing redirect',()=>{
    const site=create(),first=createContent(site,{kind:'content',type:'note',path:'/notes/11223344/'});site.saveEntry({...first.value,status:'published'},first.revision);site.publish();
    const current=site.store.get('entry',first.id)!;site.saveEntry({...current.value,path:'/notes/moved/'},current.revision);
    site.store.put('redirect','/notes/55667788/',{target:'/notes/11223344/',entryId:first.id},null);
    const random=vi.spyOn(storage,'uuid').mockReturnValueOnce('11223344-aaaa-4aaa-aaaa-aaaaaaaaaaaa').mockReturnValueOnce('55667788-bbbb-4bbb-bbbb-bbbbbbbbbbbb').mockReturnValueOnce('99aabbcc-cccc-4ccc-cccc-cccccccccccc');
    expect(createContent(site,{kind:'content',type:'note'}).value.path).toBe('/notes/99aabbcc/');expect(random).toHaveBeenCalledTimes(3);
  });
  it('fails cleanly if random generation repeatedly returns occupied addresses',()=>{
    const site=create();createContent(site,{kind:'content',type:'note',path:'/notes/11223344/'});const count=site.store.list('entry').length;
    vi.spyOn(storage,'uuid').mockReturnValue('11223344-aaaa-4aaa-aaaa-aaaaaaaaaaaa');expect(()=>createContent(site,{kind:'content',type:'note'})).toThrow(/未使用的网址/);expect(site.store.list('entry').length).toBe(count);
  });
  it('persists named typed filters with conflict checks, archive and restore', () => {
    const site = create(); createContent(site, { kind: 'content', type: 'note', title: '写作笔记' });
    const view = saveContentView(site, { id: 'writing', name: '写作草稿', query: { kind: 'content', type: 'note', status: 'draft', fields: { topic: '写作' } } }, null);
    expect(queryDrafts(site, view.value.query).total).toBe(1);
    expect(() => saveContentView(site, { ...view.value, name: '覆盖' }, null)).toThrow(/修改/);
    const archived = saveContentView(site, { ...view.value, archived: true }, view.revision);
    expect(contentViews(site)[0].value.archived).toBe(true);
    saveContentView(site, { ...archived.value, archived: false }, archived.revision);
    expect(contentViews(site)[0].value.name).toBe('写作草稿');
    expect(() => saveContentView(site, { id: 'bad', name: '坏条件', query: { kind: 'content', type: 'note', fields: { topic: '未知' } } }, null)).toThrow(/筛选/);
  });
  it('creates independent drafts from a template, retains privacy and regenerates block identities', () => {
    const site = create();
    const template = saveCreationTemplate(site, { id: 'outline', name: '写作提纲', kind: 'content', type: 'note', initial: { title: '新笔记', visibility: 'private', summaryMode: 'auto', allowComments: false, editorial: { featured: true, weight: 10, relatedIds: [] }, documentation: { group: '指南', order: 2 }, fields: { topic: '代码' }, blocks: [{ id: 'source-block', type: 'text', props: { text: '提纲' } }] } }, null);
    const a = createContent(site, { kind: 'content', templateId: template.id }), b = createContent(site, { kind: 'content', templateId: template.id });
    expect(a.id).not.toBe(b.id); expect(a.value.path).not.toBe(b.value.path);
    expect(a.value).toMatchObject({ title: '新笔记', status: 'draft', visibility: 'private', fields: { topic: '代码' } });
    expect(a.value).toMatchObject({ summaryMode: 'auto', allowComments: false, editorial: { featured: true, weight: 10 }, documentation: { group: '指南', order: 2 } });
    expect(a.value.blocks[0].id).not.toBe('source-block'); expect(a.value.blocks[0].id).not.toBe(b.value.blocks[0].id);
    site.saveEntry({ ...a.value, title: '已经修改' }, a.revision);
    saveCreationTemplate(site, { ...template.value, initial: { title: '后来的模板' } }, template.revision);
    expect(site.store.get('entry', b.id)!.value.title).toBe('新笔记');
    expect(site.release()).toBeNull();
  });
  it('validates initial values and refuses mismatched or archived templates', () => {
    const site = create();
    expect(() => saveCreationTemplate(site, { id: 'bad', name: '错误模板', kind: 'content', type: 'note', initial: { fields: { topic: '未知' } } }, null)).toThrow(/选项/);
    const template = saveCreationTemplate(site, { id: 'valid', name: '模板', kind: 'content', type: 'note', initial: {} }, null);
    expect(() => createContent(site, { kind: 'page', templateId: template.id })).toThrow(/不一致/);
    saveCreationTemplate(site, { ...template.value, archived: true }, template.revision);
    expect(() => createContent(site, { kind: 'content', templateId: template.id })).toThrow(/归档/);
    expect(creationTemplates(site)[0].value.archived).toBe(true);
  });
  it('includes authoring records in exchange preflight and atomic restore', () => {
    const source = create(), target = create();
    saveContentView(source, { id: 'view', name: '笔记', query: { kind: 'content', type: 'note', fields: { topic: '写作' } } }, null);
    saveCreationTemplate(source, { id: 'template', name: '提纲', kind: 'content', type: 'note', initial: { document: { version: 1, format: 'markdown', source: '# 标题\n\n## 要点' } } }, null);
    const exported = exportSite(source);
    expect(importSite(target, exported, { dryRun: true }).created).toContain('content-view:view');
    expect(contentViews(target)).toEqual([]);
    importSite(target, exported);
    expect(contentViews(target)[0].value.name).toBe('笔记'); expect(creationTemplates(target)[0].value.name).toBe('提纲');
    expect(createContent(target, { kind: 'content', templateId: 'template' }).value.document.source).toContain('## 要点');
  });
});
