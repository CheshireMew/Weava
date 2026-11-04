import type Database from 'better-sqlite3';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { WeavaError } from '../../contracts/src/errors.ts';

export const OWNER_ACCESS_TTL = 10 * 60 * 1000;
type Mode = 'initialize' | 'reset';
interface Grant { hash: string; mode: Mode; expiresAt: number; identity: string; resetTwoFactor: boolean }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Local issuers write an opaque grant; HTTP can only inspect or consume it.
 * Uses existing state tables so the CLI never migrates a running site's database. */
export class OwnerAccessLinks {
  constructor(private db: Database.Database) {}
  private state(key: string) { return (this.db.prepare('SELECT value FROM state WHERE key=?').get(key) as {value:string}|undefined)?.value ?? null; }
  private set(value: Grant | null) {
    this.db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run('owner-access-link', JSON.stringify(value));
  }
  private identity() { return hash(JSON.stringify([this.state('owner'), this.state('owner-security')])); }
  status() {
    const profile = JSON.parse(this.state('owner-profile') ?? '{"username":"owner"}') as {username:string};
    return {initialized: !!this.state('owner'), username: profile.username, adminPath: this.state('owner-admin-path') ?? '/admin',
      twoFactorEnabled:!!JSON.parse(this.state('owner-totp')??'null')};
  }
  issue(mode: Mode, resetTwoFactor = false) {
    return this.db.transaction(() => {
      const {initialized} = this.status();
      if (mode === 'initialize' && initialized) throw new WeavaError('账户已存在，请在本机使用 owner reset-link。', 409);
      if (mode === 'reset' && !initialized) throw new WeavaError('账户尚未设置，请在本机使用 owner setup-link。', 409);
      const token = randomBytes(32).toString('hex'), expiresAt = Date.now() + OWNER_ACCESS_TTL;
      this.set({hash: hash(token), mode, expiresAt, identity: this.identity(), resetTwoFactor: mode === 'reset' && resetTwoFactor});
      return {token, mode, expiresAt: new Date(expiresAt).toISOString()};
    }).immediate();
  }
  inspect(token: string) {
    const grant = JSON.parse(this.state('owner-access-link') ?? 'null') as Grant | null;
    if (!/^[a-f0-9]{64}$/.test(token) || !grant || !/^[a-f0-9]{64}$/.test(grant.hash) || grant.expiresAt <= Date.now() ||
      grant.identity !== this.identity() || !timingSafeEqual(Buffer.from(grant.hash),Buffer.from(hash(token))) ||
      (grant.mode === 'initialize') === this.status().initialized)
      throw new WeavaError('链接无效、已过期或已使用。请在本机重新生成设置链接。', 403);
    return {mode: grant.mode, expiresAt: new Date(grant.expiresAt).toISOString(),
      username: this.status().username, twoFactorEnabled: !!JSON.parse(this.state('owner-totp') ?? 'null'), resetTwoFactor: grant.resetTwoFactor};
  }
  consume<T>(token: string, action: (grant: ReturnType<OwnerAccessLinks['inspect']>) => T) {
    return this.db.transaction(() => {
      const grant = this.inspect(token);
      const value = action(grant);
      this.set(null);
      return value;
    }).immediate();
  }
}

export function ownerAccessUrl(origin: string, adminPath: string, token: string) {
  let base: URL;
  try {base = new URL(origin);} catch {throw new WeavaError('请提供完整的站点地址。');}
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
    !['http:', 'https:'].includes(base.protocol) ||
    (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))
    throw new WeavaError('设置链接需要 HTTPS 站点地址；本机可使用 http://127.0.0.1:端口。');
  const target = new URL(adminPath.replace(/\/$/,'') + '/', base);
  if(target.origin !== base.origin || !/^\/[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}\/$/.test(target.pathname))
    throw new WeavaError('后台入口配置无效。');
  target.hash = 'owner-access=' + token;
  return target.href;
}
