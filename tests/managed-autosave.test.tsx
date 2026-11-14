// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditSessionsProvider, useEditSessions, useManagedRecord } from '../apps/admin/src/EditSessions.tsx';
import { AutosaveStatus } from '../apps/admin/src/AutosaveStatus.tsx';

type Row = { id: string; revision: number; value: { name: string } };
let host: HTMLDivElement, root: Root, model: ReturnType<typeof useManagedRecord<Row>>, flush: () => Promise<void>;
const write = vi.fn();
function Harness() {
  model = useManagedRecord<Row>({ id: 'site', revision: 1, value: { name: '原名称' } }, write, '测试自动保存', {
    autosave: { ready: row => !!row.value.name.trim(), incompleteMessage: '请填写名称。' },
  });
  flush = useEditSessions().flush;
  return <AutosaveStatus state={model.autoSave} label="测试" />;
}
beforeEach(async () => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  write.mockReset(); write.mockImplementation(async row => ({ ...row, revision: row.revision + 1 }));
  await act(async () => root.render(<EditSessionsProvider><Harness /></EditSessionsProvider>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function change(name: string) { await act(async () => model.setRecord(row => ({ ...row!, value: { name } }))); }
async function tick(ms = 850) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

it('debounces edits and never writes an untouched form', async () => {
  await tick(); expect(write).not.toHaveBeenCalled();
  await change('第一个'); await tick(400); await change('最终名称'); await tick(790);
  expect(write).not.toHaveBeenCalled(); await tick(20);
  expect(write).toHaveBeenCalledTimes(1); expect(write.mock.calls[0][0].value.name).toBe('最终名称');
  expect(host.textContent).toBe('已保存'); expect(model.session.dirty).toBe(false);
});
it('preserves changes made while a save is in flight and updates their revision', async () => {
  let finish!: (value: Row) => void;
  write.mockImplementationOnce(row => new Promise<Row>(resolve => { finish = resolve; }));
  await change('第一版'); await tick(); expect(host.textContent).toBe('正在保存');
  await change('第二版');
  await act(async () => finish({ ...write.mock.calls[0][0], revision: 2 }));
  expect(write.mock.calls.map(([row]) => [row.revision, row.value.name])).toEqual([[1, '第一版'], [2, '第二版']]);
  expect(model.record).toMatchObject({ revision: 3, value: { name: '第二版' } });
});
it('keeps failures visible without retrying forever and lets the user retry', async () => {
  write.mockRejectedValueOnce(new Error('暂时无法保存'));
  await change('保留的修改'); await tick(); expect(host.textContent).toContain('暂时无法保存');
  await tick(5000); expect(write).toHaveBeenCalledTimes(1); expect(model.session.dirty).toBe(true);
  await act(async () => host.querySelector('button')!.click());
  expect(write).toHaveBeenCalledTimes(2); expect(host.textContent).toBe('已保存');
});
it('retries transport failures with backoff and resumes an offline edit on reconnect', async () => {
  write.mockRejectedValueOnce(Object.assign(new Error('断线'), {status:0}));
  await change('断线修改'); await tick(); expect(host.textContent).toContain('等待重试');
  await tick(1900); expect(write).toHaveBeenCalledTimes(1);
  await tick(100); expect(write).toHaveBeenCalledTimes(2); expect(model.session.dirty).toBe(false);
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  await act(async () => window.dispatchEvent(new Event('offline')));
  await change('离线继续写'); await tick(10000);
  expect(host.textContent).toContain('离线'); expect(write).toHaveBeenCalledTimes(2);
  online.mockReturnValue(true); await act(async () => window.dispatchEvent(new Event('online'))); await tick();
  expect(write).toHaveBeenCalledTimes(3); expect(host.textContent).toBe('已保存');
});
it('never automatically retries a conflict or permission failure on reconnect', async () => {
  for (const status of [409, 401, 403, 422]) {
    write.mockRejectedValueOnce(Object.assign(new Error('需要处理'), {status}));
    await change('修改'+status); await tick(); const count=write.mock.calls.length;
    await act(async () => window.dispatchEvent(new Event('online'))); await tick(60000);
    expect(write).toHaveBeenCalledTimes(count);
  }
});
it('waits for complete fields and Chinese composition, then saves the completed value', async () => {
  await change(''); await tick(); expect(write).not.toHaveBeenCalled(); expect(host.textContent).toContain('请填写名称');
  await act(async () => document.dispatchEvent(new Event('compositionstart')));
  await change('正在输入'); await tick(1500); expect(write).not.toHaveBeenCalled();
  await act(async () => document.dispatchEvent(new Event('compositionend'))); await tick();
  expect(write).toHaveBeenCalledTimes(1);
});
it('flushes a pending edit before page navigation without waiting for debounce', async () => {
  await change('离开前保存');
  await act(async () => flush());
  expect(write).toHaveBeenCalledTimes(1); await tick(2000); expect(write).toHaveBeenCalledTimes(1);
});
it('stops an invalid edit made during an in-flight save from reaching the server', async () => {
  let finish!: (value: Row) => void;
  write.mockImplementationOnce(row => new Promise<Row>(resolve => { finish = resolve; }));
  await change('有效名称'); await tick(); await change('');
  await act(async () => finish({ ...write.mock.calls[0][0], revision: 2 }));
  expect(write).toHaveBeenCalledTimes(1); expect(model.session.dirty).toBe(true);
  expect(host.textContent).toContain('请填写名称');
});
