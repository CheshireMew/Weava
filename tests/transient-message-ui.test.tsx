// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTransientMessage } from '../apps/admin/src/useTransientMessage.ts';
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
function Feedback({ context }: { context: string }) {
  const [message, setMessage] = useState('');
  useTransientMessage(message, () => setMessage(''), context);
  return <><button onClick={() => setMessage('操作提示')}>提示</button><span role="status">{message}</span></>;
}
beforeEach(() => { vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
it('expires short feedback and cancels the timer when leaving its view', async () => {
  await act(async () => root.render(<Feedback context="article:1" />));
  await act(async () => host.querySelector('button')!.click());
  expect(host.querySelector('[role=status]')?.textContent).toBe('操作提示');
  await act(async () => vi.advanceTimersByTime(4500));
  expect(host.querySelector('[role=status]')?.textContent).toBe('');
  await act(async () => host.querySelector('button')!.click());
  await act(async () => root.render(<Feedback context="article:list" />));
  expect(host.querySelector('[role=status]')?.textContent).toBe('');
  await act(async () => host.querySelector('button')!.click());
  await act(async () => vi.advanceTimersByTime(2000));
  expect(host.querySelector('[role=status]')?.textContent).toBe('操作提示');
});
