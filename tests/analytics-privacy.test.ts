import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { sessionHandlers } from '../apps/web/src/api/session.ts';
import { publicApi } from '../apps/web/src/api/public.ts';

function server() {
  const values = new Map<string, string>();
  const cookies = {
    get: (name: string) => values.has(name) ? { value: values.get(name)! } : undefined,
    set: vi.fn((name: string, value: string, _options?: unknown) => { values.set(name, value); }),
  };
  const site = { authenticate: (token: string) => token === 'owner-session', cliToken: () => 'cli', ownerExists: () => true,
    login: vi.fn(async () => 'owner-session'), logout: vi.fn(), visibleRelease: () => ({ entries: [{ path: '/', visibility: 'public' }] }) };
  const collect = vi.fn(() => ({ accepted: 1 }));
  const services = { site, analytics: { collect }, engagement: {} } as any;
  const context = () => {
    const url = new URL('https://example.test/api/v1/analytics');
    return { url, cookies, identity: { protocol: 'https:', secure: true, network: '127.0.0.1' },
      request: new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' }) } as any;
  };
  return { values, cookies, services, collect, context, handlers: sessionHandlers(services) };
}

it('counts ordinary visitors and automatically excludes the owner through login and logout', async () => {
  const s = server();
  expect(await (await publicApi(s.services, s.context(), 'v1/analytics'))!.json()).toEqual({ accepted: 1 });
  s.collect.mockClear();
  await s.handlers.login({ body: { password: 'password', username: 'owner' } } as any, s.context());
  expect(s.cookies.set).toHaveBeenCalledWith('weava-exclude', '1', expect.objectContaining({ path: '/', maxAge: 31536000 }));
  expect(await (await publicApi(s.services, s.context(), 'v1/analytics'))!.json()).toEqual({ accepted: 0 });
  await s.handlers.logout({} as any, s.context());
  expect(await (await publicApi(s.services, s.context(), 'v1/analytics'))!.json()).toEqual({ accepted: 0 });
  expect(s.collect).not.toHaveBeenCalled();
});

it('marks existing owner sessions and rejects their events even before the preference is saved', async () => {
  const s = server();
  expect((await s.handlers.session({} as any, s.context())).authenticated).toBe(false);
  expect(s.values.has('weava-exclude')).toBe(false);
  s.values.set('weava-session', 'owner-session');
  expect(await (await publicApi(s.services, s.context(), 'v1/analytics'))!.json()).toEqual({ accepted: 0 });
  expect(s.collect).not.toHaveBeenCalled();
  expect((await s.handlers.session({} as any, s.context())).authenticated).toBe(true);
  expect(s.values.get('weava-exclude')).toBe('1');
});

function browser(cookies: Map<string, string>) {
  const storage = () => {
    const items = new Map<string, string>();
    return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => items.set(key, value), removeItem: (key: string) => items.delete(key) };
  };
  const localStorage = storage(), sessionStorage = storage(), events = new EventTarget();
  localStorage.setItem('weava-exclude', '0');
  sessionStorage.setItem('weava-events-v2', JSON.stringify([{ id: 'queued-before-login' }]));
  const window = { localStorage, sessionStorage, addEventListener: events.addEventListener.bind(events) };
  const fetch = vi.fn(async () => ({ ok: true }));
  let tick = () => {};
  runInNewContext(readFileSync('apps/web/public/weava-analytics.js', 'utf8'), {
    window, fetch, crypto: { randomUUID }, URL, URLSearchParams, TextEncoder, Element: class {},
    location: { pathname: '/', search: '', origin: 'https://example.test' },
    navigator: { language: 'zh-CN', maxTouchPoints: 0 }, scrollY: 0, innerHeight: 900,
    document: { visibilityState: 'visible', referrer: '', body: { dataset: {} }, documentElement: { scrollHeight: 1200 },
      get cookie() { return [...cookies].map(([name, value]) => name + '=' + value).join('; '); }, addEventListener: () => {} },
    setInterval: (callback: () => void) => { tick = callback; }, setTimeout: () => {},
  });
  return { fetch, sessionStorage, tick: () => tick(), leave: () => events.dispatchEvent(new Event('pagehide')) };
}

it('stops already-open pages and discards pending events on the next load after owner exclusion', async () => {
  const cookies = new Map<string, string>(), page = browser(cookies);
  await Promise.resolve(); await Promise.resolve();
  expect(page.fetch).toHaveBeenCalledTimes(1);
  cookies.set('weava-exclude', '1');
  page.tick(); page.leave();
  expect(page.fetch).toHaveBeenCalledTimes(1);
  const nextPage = browser(cookies);
  expect(nextPage.fetch).not.toHaveBeenCalled();
  expect(nextPage.sessionStorage.getItem('weava-events-v2')).toBeNull();
});
