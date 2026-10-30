import { afterEach, describe, expect, it } from 'vitest';
import { Site, checkEntry, importSite, queryDrafts, queryReferences } from '@weava/core';
import { entrySchema, fieldDefaults, fieldIssues, type ContentType, type FieldDefinition } from '@weava/contracts';

const sites: Site[] = [], root = 'D:/Tools/cache/weava/tests/content-models-' + Date.now(); let sequence = 0;
const create = () => { const site = new Site(root + '/' + sequence++); sites.push(site); return site; };
afterEach(() => sites.splice(0).forEach((site) => site.close()));
const type = (fields: FieldDefinition[], extra: Partial<ContentType> = {}): ContentType => ({ id: 'project', label: '项目', pathPrefix: '/projects/', template: 'article', fields, ...extra });
const entry = (id: string, fields: Record<string, any> = {}, contentType = 'project') => entrySchema.parse({ id, kind: 'content', type: contentType, title: id, path: '/' + id + '/', fields });

describe('content model rules across all entry points', () => {
  it('shares numeric, Unicode length, array and nested field errors with exact paths', () => {
    const fields: FieldDefinition[] = [{ key: 'rating', label: '评分', type: 'number', min: 0, max: 10 },
      { key: 'name', label: '名称', type: 'text', minLength: 2, maxLength: 3 },
      { key: 'team', label: '团队', type: 'group', multiple: true, minItems: 1, maxItems: 2, fields: [{ key: 'name', label: '姓名', type: 'text', required: true }] }];
    expect(fieldIssues(fields, { rating: 11, name: '😀', team: [{ name: '' }] }).map((error) => error.path)).toEqual(['rating', 'name', 'team.0.name']);
    expect(fieldIssues(fields, { rating: 0, name: '😀a', team: [{ name: '甲' }] })).toEqual([]);
    expect(fieldIssues(fields, { team: [] })).toMatchObject([{ path: 'team', code: 'minItems' }]);
    expect(fieldIssues(fields, { team: [{}, {}, {}] })).toMatchObject([{ path: 'team', code: 'maxItems' }, { path: 'team.0.name' }, { path: 'team.1.name' }, { path: 'team.2.name' }]);
  });

  it('fills only missing defaults and preserves hidden values and cleared fields', () => {
    const definitions: FieldDefinition[] = [{ key: 'external', label: '外部', type: 'boolean', defaultValue: false }, { key: 'url', label: '链接', type: 'text', required: true, condition: { field: 'external', operator: 'equals', value: true } }, { key: 'label', label: '标题', type: 'text', defaultValue: '默认' }];
    expect(fieldDefaults(definitions, { label: '' })).toEqual({ label: '', external: false });
    expect(fieldIssues(definitions, { external: false, url: '保留旧值' })).toEqual([]);
    expect(fieldIssues(definitions, { external: true })).toMatchObject([{ path: 'url', code: 'required' }]);
    const site = create(); site.saveType(type(definitions), null);
    const saved = site.saveEntry(entry('a', { url: '保留旧值', label: '' }), null);
    expect(saved.value.fields).toEqual({ external: false, url: '保留旧值', label: '' });
    const edited = site.saveEntry({ ...saved.value, fields: { external: true } }, saved.revision);
    expect(edited.value.fields.url).toBe('保留旧值');
  });

  it('returns all unsaved candidate errors without writing records, revisions or publication', () => {
    const site = create(); site.saveType(type([{ key: 'rating', label: '评分', type: 'number', max: 10 }, { key: 'name', label: '名称', type: 'text', required: true }]), null);
    const before = site.store.raw.prepare('SELECT COUNT(*) n FROM revisions').get();
    const checked = checkEntry(site, entry('unsaved', { rating: 20 }));
    expect(checked.valid).toBe(false); expect(checked.errors.map((error) => error.path)).toEqual(['fields.rating', 'fields.name']);
    expect(site.store.get('entry', 'unsaved')).toBeNull();
    expect(site.store.raw.prepare('SELECT COUNT(*) n FROM revisions').get()).toEqual(before);
    expect(site.release()).toBeNull();
    expect(() => site.saveEntry(entry('invalid', { rating: 20 }), null)).toThrow(/评分/);
  });

  it('uses the same target type and typed predicate in pickers, save and publish', () => {
    const site = create(); site.saveType(type([], { id: 'client' }), null);
    site.saveType(type([{ key: 'client', label: '客户', type: 'reference', referenceTypes: ['client'], referenceFilters: { active: true } }]), null);
    const a = site.saveEntry(entry('client-a', { active: true }, 'client'), null);
    site.saveEntry(entry('client-b', { active: false }, 'client'), null);
    site.saveEntry(entry('other', { active: true }), null);
    expect(queryReferences(site, { referenceTypes: ['client'], referenceFilters: { active: true } }).items.map((row) => row.id)).toEqual(['client-a']);
    expect(() => site.saveEntry(entry('project-a', { client: 'other' }), null)).toThrow(/关联内容/);
    expect(() => site.saveEntry(entry('project-a', { client: 'client-b' }), null)).toThrow(/关联内容/);
    expect(() => site.saveEntry(entry('project-a', { client: 'missing' }), null)).toThrow(/不存在/);
    const p = site.saveEntry(entry('project-a', { client: a.id }), null);
    site.publish({ ids: [a.id, p.id] });
    site.saveEntry({ ...a.value, fields: { active: false } }, a.revision);
    const oldRelease = site.release()!.id;
    expect(() => site.publish({ ids: [a.id] })).toThrow(/字段校验/);
    expect(site.release()!.id).toBe(oldRelease);
  });

  it('preflights forward references during atomic import instead of depending on input order', () => {
    const site = create();
    importSite(site, { version: 1, types: [type([{ key: 'next', label: '下一个', type: 'reference', referenceTypes: ['project'] }])], entries: [entry('first', { next: 'second' }), entry('second', { next: 'first' })] });
    expect(site.store.get('entry', 'first')!.value.fields.next).toBe('second');
    expect(() => importSite(site, { version: 1, entries: [entry('bad', { next: 'not-there' })] })).toThrow(/不存在/);
    expect(site.store.get('entry', 'bad')).toBeNull();
  });

  it('rejects invalid definitions and incompatible changes without discarding old values', () => {
    const site = create();
    expect(() => site.saveType(type([{ key: 'number', label: '数字', type: 'number', min: 5, max: 1 }]), null)).toThrow(/字段定义/);
    expect(() => site.saveType(type([{ key: 'name', label: '名称', type: 'text', condition: { field: 'missing', operator: 'hasValue' } }]), null)).toThrow(/字段定义/);
    expect(() => site.saveType(type([{ key: 'name', label: '名称', type: 'number', defaultValue: 'wrong' }]), null)).toThrow(/字段定义/);
    const schema = site.saveType(type([{ key: 'rating', label: '评分', type: 'number' }]), null);
    const content = site.saveEntry(entry('saved', { rating: 12, retired: '保留' }), null);
    expect(() => site.saveType(type([{ key: 'rating', label: '评分', type: 'number', max: 10 }]), schema.revision)).toThrow(/不兼容/);
    expect(site.store.get('entry', content.id)!.value.fields.retired).toBe('保留');
  });

  it('stores per-type admin configuration and only adds declared list columns to summaries', () => {
    const site = create(); site.saveType(type([{ key: 'rating', label: '评分', type: 'number' }, { key: 'privateNote', label: '备注', type: 'text' }], { admin: { fields: [{ key: 'rating', width: 'half' }], columns: ['title', 'rating'], sort: '-title' } }), null);
    site.saveEntry(entry('a', { rating: 1, privateNote: '不取入列表' }), null); site.saveEntry(entry('b', { rating: 2 }), null);
    const result = queryDrafts(site, { type: 'project', sort: '-title' });
    expect(result.items.map((row) => row.id)).toEqual(['b', 'a']);
    expect(result.items[1].value.fields).toEqual({ rating: 1 });
    expect(() => site.saveType(type([], { id: 'invalid', admin: { columns: ['missing'] } }), null)).toThrow(/不存在的字段/);
  });
});
