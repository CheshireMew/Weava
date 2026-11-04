import type { Entry, Revision } from '@weava/contracts';
import { sameEditableValue } from './edit-session.ts';

interface DraftStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface LocalDraft { id: string; capturedAt: number; updatedAt: number; pending?: boolean; record: Revision<Entry> }
interface DraftArchive { version: 2; entries: Record<string, LocalDraft[]> }
const key = 'weava-drafts:v2', byteLimit = 3 * 1024 * 1024;
export function latestPendingDraft(copies: LocalDraft[]): LocalDraft[] {
  return copies.filter(copy => copy.pending !== false).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 1);
}
export function matchesDraft(copy: Pick<LocalDraft, 'record'>, record: Revision<Entry>) {
  // Saving changes metadata; recovery is needed only when authored content differs.
  return sameEditableValue({...copy.record.value, updatedAt: undefined}, {...record.value, updatedAt: undefined});
}
const read = (storage: DraftStorage): DraftArchive => {
  const raw = storage.getItem(key);
  if (!raw) return { version: 2, entries: Object.create(null) };
  const archive = JSON.parse(raw);
  if (archive.version !== 2 || !archive.entries || typeof archive.entries !== 'object' || Array.isArray(archive.entries)) throw new Error('浏览器草稿格式无法读取，请先保留浏览器数据。');
  return { version: 2, entries: Object.assign(Object.create(null), archive.entries) };
};
function store(archive: DraftArchive, storage: DraftStorage, preserve: string) {
  for (const id of Object.keys(archive.entries)) {
    archive.entries[id] = latestPendingDraft(archive.entries[id]);
    if (!archive.entries[id].length) delete archive.entries[id];
  }
  const ids = Object.keys(archive.entries).sort((a, b) => archive.entries[b][0]?.updatedAt - archive.entries[a][0]?.updatedAt);
  for (const id of ids.slice(40)) if (id !== preserve) delete archive.entries[id];
  const trim = () => {
    const oldest = Object.entries(archive.entries).flatMap(([id, copies]) => copies.map((copy, index) => ({ id, index, copy }))).filter((item) => item.id !== preserve || item.index > 0).sort((a, b) => a.copy.updatedAt - b.copy.updatedAt)[0];
    if (!oldest) return false;
    archive.entries[oldest.id].splice(oldest.index, 1);
    if (!archive.entries[oldest.id].length) delete archive.entries[oldest.id];
    return true;
  };
  while (JSON.stringify(archive).length * 2 > byteLimit) if (!trim()) throw new Error('这份草稿过大，浏览器无法保留副本；请保持页面打开并保存到网站。');
  for (;;) {
    try { storage.setItem(key, JSON.stringify(archive)); return; }
    catch { if (!trim()) throw new Error('浏览器无法保存本地草稿，请保持页面打开并保存到网站。'); }
  }
}
export function localDrafts(id: string, storage: DraftStorage = localStorage): LocalDraft[] {
  const archive = read(storage), copies = latestPendingDraft(archive.entries[id] ?? []);
  const legacy = storage.getItem('weava-draft:' + id);
  if (!copies.length && legacy) {
    const record = JSON.parse(legacy);
    if (record?.id === id && record?.value) return [{ id: 'legacy', capturedAt: 0, updatedAt: 0, record }];
  }
  return copies;
}
export function saveLocalDraft(record: Revision<Entry>, storage: DraftStorage = localStorage, clock = Date.now()) {
  const archive = read(storage);
  archive.entries[record.id] = [{ id: record.id, capturedAt: clock, updatedAt: clock, pending: true, record: structuredClone(record) }];
  store(archive, storage, record.id);
  // Migration completes only after the replacement has been written successfully.
  storage.removeItem('weava-draft:' + record.id);
}
export function acknowledgeLocalDrafts(record: Revision<Entry>, storage: DraftStorage = localStorage) {
  const archive = read(storage);
  if (archive.entries[record.id]) archive.entries[record.id] = archive.entries[record.id].filter(copy => !matchesDraft(copy, record));
  store(archive, storage, record.id);
  const legacy = storage.getItem('weava-draft:' + record.id);
  if (legacy && matchesDraft({record: JSON.parse(legacy)}, record)) storage.removeItem('weava-draft:' + record.id);
}
export function forgetLocalDrafts(id: string, storage: DraftStorage = localStorage) {
  const archive = read(storage);
  delete archive.entries[id];
  storage.setItem(key, JSON.stringify(archive));
  storage.removeItem('weava-draft:' + id);
}
