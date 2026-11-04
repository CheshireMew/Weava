import { expect, it, vi } from 'vitest';
import { SettingsApplication } from '../apps/admin/src/useSettingsApplication.ts';

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it('does not publish untouched settings and coalesces edits made during publication', async () => {
  const first = deferred(), second = deferred();
  const apply = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const completed = vi.fn(), model = new SettingsApplication(apply, () => {}, completed);
  await model.flush(); expect(apply).not.toHaveBeenCalled();
  expect(completed).not.toHaveBeenCalled();
  model.request(); model.request(); model.request();
  expect(apply).toHaveBeenCalledTimes(1); expect(model.state.phase).toBe('saving');
  first.resolve(); await Promise.resolve();
  expect(apply).toHaveBeenCalledTimes(2); expect(model.state.phase).toBe('saving');
  second.resolve(); await model.flush();
  expect(model.state.phase).toBe('saved'); expect(apply).toHaveBeenCalledTimes(2);
  expect(completed).toHaveBeenCalledTimes(1);
});

it('keeps a failed application visible and retries the saved settings without a new edit', async () => {
  const apply = vi.fn().mockRejectedValueOnce(new Error('暂时无法连接')).mockResolvedValue(undefined);
  const completed = vi.fn(), model = new SettingsApplication(apply, () => {}, completed);
  model.request(); await model.flush().catch(() => {});
  expect(model.state.phase).toBe('error'); expect(model.state.error).toContain('设置已保存，更新网站失败');
  expect(apply).toHaveBeenCalledTimes(1);
  expect(completed).not.toHaveBeenCalled();
  await model.state.retry(); expect(apply).toHaveBeenCalledTimes(2); expect(model.state.phase).toBe('saved');
  expect(completed).toHaveBeenCalledTimes(1);
});

it('refreshes a stale publication once and does not retry a persistent conflict forever', async () => {
  const conflict = Object.assign(new Error('工作稿已变化'), { status: 409 });
  const apply = vi.fn().mockRejectedValue(conflict), model = new SettingsApplication(apply, () => {});
  model.request(); await model.flush().catch(() => {});
  expect(apply).toHaveBeenCalledTimes(2); expect(model.state.phase).toBe('error');
});

it('continues with the latest saved value when an older publication fails during another edit', async () => {
  const old = deferred(), apply = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(undefined);
  const model = new SettingsApplication(apply, () => {});
  model.request(); model.request(); old.reject(new Error('旧版本已变化'));
  await model.flush(); expect(apply).toHaveBeenCalledTimes(2); expect(model.state.phase).toBe('saved');
});

it('resumes unapplied settings only once instead of repeatedly publishing on refresh', async () => {
  const apply = vi.fn().mockResolvedValue(undefined), model = new SettingsApplication(apply, () => {});
  model.resumePending(); await model.flush(); model.resumePending();
  expect(apply).toHaveBeenCalledTimes(1);
});
