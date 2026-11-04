import { Apple, Bot, CircleHelp, Compass, Flame, Globe, Monitor, Smartphone, Tablet } from 'lucide-react';
import type { AnalyticsVisitor, AnalyticsRealtime } from '@weava/contracts';
import { country, devices } from './format.ts';

export function CountryFlag({ code }: { code: string }) {
  const known = ['CN', 'SG', 'JP', 'US', 'GB', 'HK', 'DE', 'FR', 'CA'];
  if (!known.includes(code)) return <Globe size={15} aria-label={country(code)} />;
  return <svg className="analytics-flag" viewBox="0 0 24 16" role="img" aria-label={country(code)}><title>{country(code)}</title>
    <rect width="24" height="16" rx="1" fill={['JP', 'FR', 'CA'].includes(code) ? '#fff' : ['US', 'GB', 'AU'].includes(code) ? '#244478' : '#df303b'} />
    {code === 'CN' && <><path d="m5 2 1 3h3L6.5 7 7.5 10 5 8 2.5 10 3.5 7 1 5h3z" fill="#ffde4d" /><circle cx="11" cy="3" r=".7" fill="#ffde4d" /><circle cx="12" cy="6" r=".7" fill="#ffde4d" /></>}
    {code === 'JP' && <circle cx="12" cy="8" r="4.5" fill="#cd293e" />}
    {code === 'SG' && <><path d="M0 8h24v8H0z" fill="#fff" /><circle cx="6" cy="4" r="3" fill="#fff" /><circle cx="7" cy="3.5" r="2.5" fill="#df303b" /><circle cx="11" cy="3" r=".6" fill="#fff" /></>}
    {code === 'US' && <>{[0, 4, 8, 12].map(y => <rect key={y} y={y} width="24" height="2" fill="#fff" />)}<rect width="10" height="8" fill="#244478" /><path d="M2 2h1m2 0h1m2 0h1M2 5h1m2 0h1m2 0h1" stroke="#fff" /></>}
    {['GB', 'AU'].includes(code) && <><path d="m0 0 24 16M24 0 0 16" stroke="#fff" strokeWidth="3" /><path d="M12 0v16M0 8h24" stroke="#fff" strokeWidth="6" /><path d="M12 0v16M0 8h24" stroke="#d83241" strokeWidth="3" /></>}
    {code === 'HK' && <>{[0, 72, 144, 216, 288].map(angle => <ellipse key={angle} cx="12" cy="5" rx="1.5" ry="3" fill="#fff" transform={`rotate(${angle} 12 8)`} />)}</>}
    {code === 'DE' && <><path d="M0 0h24v5H0z" fill="#20252d" /><path d="M0 11h24v5H0z" fill="#f5cc43" /></>}
    {code === 'FR' && <><path d="M0 0h8v16H0z" fill="#2856a3" /><path d="M16 0h8v16h-8z" fill="#df303b" /></>}
    {code === 'CA' && <><path d="M0 0h5v16H0zM19 0h5v16h-5z" fill="#df303b" /><path d="m12 3 2 4 3-1-1 5-4 2-4-2-1-5 3 1z" fill="#df303b" /></>}
  </svg>;
}
export function BrowserIcon({ name }: { name: string }) {
  if (/chrome|chromium/i.test(name)) return <svg viewBox="0 0 20 20" width="16" height="16" aria-label={name}><circle cx="10" cy="10" r="9" fill="#e6b737" /><path d="M2 6a9 9 0 0 1 16 0H9l-4 7z" fill="#de574b" /><path d="m2 6 6 11a9 9 0 0 1-6-11" fill="#45a36a" /><circle cx="10" cy="10" r="4" fill="#4294d0" stroke="#fff" /></svg>;
  if (/edge/i.test(name)) return <span className="analytics-brand-icon edge" aria-label={name}>e</span>;
  if (/safari/i.test(name)) return <Compass size={16} color="#348bc4" aria-label={name} />;
  if (/firefox/i.test(name)) return <Flame size={16} color="#dd7c38" aria-label={name} />;
  return <Globe size={15} aria-label={name || '未知浏览器'} />;
}
export function OsIcon({ name }: { name: string }) {
  if (/windows/i.test(name)) return <svg viewBox="0 0 16 16" width="14" height="14" aria-label={name}><path d="M0 0h7v7H0zm9 0h7v7H9zM0 9h7v7H0zm9 0h7v7H9z" fill="#388fcb" /></svg>;
  if (/mac|ios/i.test(name)) return <Apple size={15} aria-label={name} />;
  if (/android/i.test(name)) return <Bot size={16} color="#5d9b65" aria-label={name} />;
  return <CircleHelp size={15} aria-label={name || '未知系统'} />;
}
export function DeviceIcon({ name }: { name: string }) {
  const Icon = name === 'smartphone' ? Smartphone : name === 'tablet' ? Tablet : Monitor;
  return <Icon size={15} aria-label={devices[name] || name} />;
}
export function VisitorIdentity({ visitor: v, onOpen }: {
  visitor: Pick<AnalyticsVisitor | AnalyticsRealtime['visitors'][number], 'id' | 'country' | 'browser' | 'os' | 'device'>;
  onOpen: (id: string) => void;
}) {
  const label = `${country(v.country)} · ${v.browser || '未知浏览器'} · ${v.os || '未知系统'} · ${devices[v.device] || v.device}`;
  return <button type="button" className="analytics-visitor-identity" aria-label={'查看访客：' + label} title={label + '\n访客 ' + v.id.slice(0, 8)} onClick={() => onOpen(v.id)}>
    <CountryFlag code={v.country} /><BrowserIcon name={v.browser} /><OsIcon name={v.os} /><DeviceIcon name={v.device} />
  </button>;
}
