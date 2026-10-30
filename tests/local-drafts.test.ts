import { describe, expect, it } from 'vitest';
import { entrySchema } from '@weava/contracts';
import { localDrafts, saveLocalDraft, forgetLocalDrafts, acknowledgeLocalDrafts } from '../apps/admin/src/local-drafts.ts';

class MemoryStorage {
  values = new Map<string, string>(); limit = Infinity;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (value.length * 2 > this.limit) throw new Error('quota'); this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const record = (title: string, id = 'entry') => ({ id, revision: 1, updatedAt: '2026-10-30T00:00:00Z', value: entrySchema.parse({ id, kind: 'page', title, path: '/' + id + '/' }) });
describe('bounded local draft recovery', () => {
  it('coalesces typing but keeps distinct recoverable versions and never exceeds ten per entry', () => {
    const storage = new MemoryStorage(); saveLocalDraft(record('第一版'), storage, 1000);
    saveLocalDraft(record('第一版补充'), storage, 2000); expect(localDrafts('entry', storage)).toHaveLength(1);
    for (let i = 0; i < 15; i++) saveLocalDraft(record('版本' + i), storage, 17000 + i * 16000);
    expect(localDrafts('entry', storage)).toHaveLength(10); expect(localDrafts('entry', storage)[0].record.value.title).toBe('版本14');
  });
  it('acknowledges successful saves without discarding other recovery copies; restoring creates a distinct copy', () => {
    const storage = new MemoryStorage(); saveLocalDraft(record('旧版'), storage, 1000); saveLocalDraft(record('新版'), storage, 17000);
    saveLocalDraft(record('旧版'), storage, 18000, true);
    acknowledgeLocalDrafts('entry', storage);
    expect(localDrafts('entry', storage).map((copy) => copy.record.value.title)).toEqual(['旧版', '新版', '旧版']);
    expect(localDrafts('entry', storage).every((copy) => copy.pending === false)).toBe(true);
    saveLocalDraft(record('继续写作'), storage, 19000); expect(localDrafts('entry', storage)).toHaveLength(4);
    expect(localDrafts('entry', storage)[0].pending).toBe(true);
  });
  it('migrates the previous single copy only after writing the new archive succeeds', () => {
    const storage = new MemoryStorage(); storage.setItem('weava-draft:entry', JSON.stringify(record('此前草稿')));
    expect(localDrafts('entry', storage)[0].id).toBe('legacy');
    storage.limit = 1;
    expect(() => saveLocalDraft(record('新副本'), storage, 1000)).toThrow(/无法保存/);
    expect(storage.getItem('weava-draft:entry')).not.toBeNull();
    storage.limit = Infinity; saveLocalDraft(record('新副本'), storage, 1000);
    expect(storage.getItem('weava-draft:entry')).toBeNull(); expect(localDrafts('entry', storage)[0].record.value.title).toBe('新副本');
  });
  it('retains the existing archive on failure and bounds storage across entries', () => {
    const storage = new MemoryStorage(); saveLocalDraft(record('已有副本'), storage, 1000);
    const old = storage.getItem('weava-drafts:v2'); storage.limit = 1;
    expect(() => saveLocalDraft(record('不能保存'), storage, 17000)).toThrow(); expect(storage.getItem('weava-drafts:v2')).toBe(old);
    storage.limit = Infinity;
    for (let i = 0; i < 50; i++) saveLocalDraft(record('内容' + i, 'entry-' + i), storage, 20000 + i);
    expect(Object.keys(JSON.parse(storage.getItem('weava-drafts:v2')!).entries).length).toBe(40);
    const oversized = record('大文件'); oversized.value.document = { version: 1, format: 'markdown', source: '字'.repeat(2_000_000) };
    const before = storage.getItem('weava-drafts:v2'); expect(() => saveLocalDraft(oversized, storage)).toThrow(/过大/); expect(storage.getItem('weava-drafts:v2')).toBe(before);
  });
  it('forgets only the explicitly selected entry and accepts imported content identifiers', () => {
    const storage = new MemoryStorage(); saveLocalDraft(record('普通'), storage); saveLocalDraft(record('导入', '__proto__'), storage);
    expect(localDrafts('__proto__', storage)[0].record.value.title).toBe('导入');
    forgetLocalDrafts('entry', storage); expect(localDrafts('entry', storage)).toEqual([]); expect(localDrafts('__proto__', storage)).toHaveLength(1);
  });
});
