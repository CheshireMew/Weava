// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTransientMessage } from '../apps/admin/src/useTransientMessage.ts';
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
function Feedback({ context, duration }: { context: string; duration?: number }) {
  const [message, setMessage] = useState('');
  useTransientMessage(message, () => setMessage(''), context, duration);
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
it('keeps errors visible until dismissed or the user leaves the affected view', async () => {
  await act(async () => root.render(<Feedback context="article:1" duration={0} />));
  await act(async () => host.querySelector('button')!.click());
  await act(async () => vi.advanceTimersByTime(30000));
  expect(host.querySelector('[role=status]')?.textContent).toBe('操作提示');
  await act(async () => root.render(<Feedback context="article:list" duration={0} />));
  expect(host.querySelector('[role=status]')?.textContent).toBe('');
});
it('keeps new completion feedback created while returning from an editor to its list',async()=>{
 function Completion(){const[context,setContext]=useState('note:one'),[message,setMessage]=useState('');useTransientMessage(message,()=>setMessage(''),context,3000);return <><button onClick={()=>{setContext('note:list');setMessage('笔记已更新发布');}}>更新发布</button><p role="status">{message}</p></>;}
 await act(async()=>root.render(<Completion/>));await act(async()=>host.querySelector('button')!.click());
 expect(host.querySelector('[role="status"]')?.textContent).toBe('笔记已更新发布');
 await act(async()=>vi.advanceTimersByTime(3000));expect(host.querySelector('[role="status"]')?.textContent).toBe('');
});
