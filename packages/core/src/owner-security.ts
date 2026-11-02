import { WeavaError } from '@weava/contracts';
import { Storage, digest } from './storage.ts';

export type SecurityEvent = 'account-initialized' | 'password-reset' | 'account-recovered' | 'account-updated' |
  'login-succeeded' | 'login-failed' | 'logout' | 'sessions-revoked' | 'two-factor-enabled' |
  'two-factor-disabled' | 'two-factor-reset' | 'recovery-code-used' | 'recovery-codes-renewed' |
  'cli-token-rotated' | 'admin-path-changed';
export class OwnerSecurity {
  constructor(private store: Storage) {}
  record(event: SecurityEvent, network = '', source: 'browser' | 'cli' = 'browser') {
    this.store.raw.prepare('INSERT INTO owner_security_events(created_at,event,source,network_key) VALUES(?,?,?,?)')
      .run(Date.now(), event, source, network ? digest(network) : '');
    this.store.raw.prepare('DELETE FROM owner_security_events WHERE id NOT IN (SELECT id FROM owner_security_events ORDER BY id DESC LIMIT 1000)').run();
  }
  events() {
    return (this.store.raw.prepare('SELECT id,created_at,event,source FROM owner_security_events ORDER BY id DESC LIMIT 100').all() as {id:number;created_at:number;event:string;source:string}[])
      .map(row => ({id:row.id,createdAt:new Date(row.created_at).toISOString(),event:row.event,source:row.source}));
  }
  private keys(scope: string, network: string) { return [scope + ':' + digest(network), scope + ':all']; }
  private limited(until: number): never {
    const retryAfter = Math.max(1, Math.ceil((until - Date.now()) / 1000));
    throw new WeavaError(`尝试过于频繁，请在 ${retryAfter} 秒后重试。`, 429, {retryAfter,retryAt:until});
  }
  reserve(scope: 'login' | 'account', network: string) {
    const now = Date.now(), bucket = Math.floor(now / 60000), reset = (bucket + 1) * 60000;
    this.store.raw.transaction(() => {
      this.store.raw.prepare('DELETE FROM owner_auth_failures WHERE expires<=?').run(now);
      const keys = this.keys(scope, network);
      for (const id of keys) {
        const row = this.store.raw.prepare('SELECT blocked_until FROM owner_auth_failures WHERE id=?').get(id) as {blocked_until:number}|undefined;
        if (row && row.blocked_until > now) this.limited(row.blocked_until);
      }
      this.store.raw.prepare('DELETE FROM engagement_limits WHERE id LIKE ? AND reset_at<=?').run(scope + ':%', now);
      for (const [index,id] of keys.entries()) {
        const key = id + ':' + bucket, max = index === 0 ? (scope === 'login' ? 10 : 20) : (scope === 'login' ? 60 : 120);
        const row = this.store.raw.prepare('SELECT count FROM engagement_limits WHERE id=?').get(key) as {count:number}|undefined;
        if ((row?.count ?? 0) >= max) this.limited(reset);
        this.store.raw.prepare('INSERT INTO engagement_limits VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1').run(key,reset);
      }
    }).immediate();
  }
  failed(scope: string, network: string) {
    const now = Date.now();
    this.store.raw.transaction(() => {
      for (const [index,id] of this.keys(scope, network).entries()) {
        const row = this.store.raw.prepare('SELECT failures,expires FROM owner_auth_failures WHERE id=?').get(id) as {failures:number;expires:number}|undefined;
        const failures = (row && row.expires > now ? row.failures : 0) + 1;
        const threshold = index === 0 ? 5 : 30, cap = index === 0 ? 300000 : 30000;
        const delay = failures < threshold ? 0 : Math.min(cap, 2000 * 2 ** Math.min(failures - threshold, 20));
        this.store.raw.prepare('INSERT INTO owner_auth_failures VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET failures=excluded.failures,expires=excluded.expires,blocked_until=excluded.blocked_until')
          .run(id,failures,now + 600000,now + delay);
      }
      this.record('login-failed', network);
    }).immediate();
  }
  succeeded(scope: string, network: string) {
    // A valid login clears this client's failures; distributed failures still expire naturally.
    this.store.raw.prepare('DELETE FROM owner_auth_failures WHERE id=?').run(this.keys(scope,network)[0]);
  }
  reset() { this.store.raw.exec('DELETE FROM owner_auth_failures; DELETE FROM engagement_limits WHERE id LIKE \'login:%\' OR id LIKE \'account:%\''); }
}
