import {join} from 'node:path';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {randomBytes,scryptSync,scrypt,timingSafeEqual} from 'node:crypto';
import {Storage} from './storage.ts';
import {digest} from '../../runtime-common/src/identity.ts';
import {newTotpSecret,sealSecret,openSecret,totpStep} from './two-factor.ts';
import {validateOwnerName,validateOwnerPassword} from './password-policy.ts';
import {validateAdminPath} from './admin-access.ts';
import {OwnerSecurity} from './owner-security.ts';
import {UAParser} from 'ua-parser-js';
import {loadRelease} from './release-reader.ts';
import {OwnerAccessLinks} from './owner-access-links.ts';

import {WeavaError} from '@weava/contracts';
export class OwnerAuth {
  private loginInFlight = 0;
  private security: OwnerSecurity;
  constructor(
    private store: Storage,
    private root: string,
  ) { this.security = new OwnerSecurity(store); }
  setOwner(password: string, source:'browser'|'cli'='cli', network='') {
    validateOwnerPassword(password, this.profile().username);
    const existed = this.ownerExists();
    const salt = randomBytes(16).toString('hex');
    this.store.raw.transaction(() => {
      this.store.setState('owner', salt + ':' + scryptSync(password, salt, 64).toString('hex'));
      this.advanceSecurity();
      this.store.raw.prepare('UPDATE sessions SET expires=0').run();
      this.security.reset();
      this.security.record(existed ? 'password-reset' : 'account-initialized', network, source);
    }).immediate();
  }
  ownerExists() {
    return !!this.store.state('owner');
  }
  private accessGrant(token:string,network:string) {
    this.security.reserve('access',network);
    try{return new OwnerAccessLinks(this.store.raw).inspect(token);}
    catch(error){this.security.failed('access',network);throw error;}
  }
  accessInfo(token:string,network:string) { return this.accessGrant(token,network); }
  async completeAccess(token:string,network:string,value:{username:string;password:string;confirmPassword:string}) {
    this.accessGrant(token,network);
    validateOwnerName(value.username);validateOwnerPassword(value.password,value.username);
    if(value.password!==value.confirmPassword)throw new WeavaError('两次输入的密码不一致。');
    if(this.loginInFlight>=2)throw new WeavaError('验证请求较多，请稍后重试。',429,{retryAfter:1,retryAt:Date.now()+1000});
    const salt=randomBytes(16).toString('hex');this.loginInFlight++;
    let key:Buffer;
    try{key=await new Promise<Buffer>((resolve,reject)=>scrypt(value.password,salt,64,(error,key)=>error?reject(error):resolve(key)));}
    finally{this.loginInFlight--;}
    return new OwnerAccessLinks(this.store.raw).consume(token,grant=>{
      this.store.setState('owner-profile',JSON.stringify({...this.profile(),username:value.username}));
      this.store.setState('owner',salt+':'+key.toString('hex'));
      if(grant.resetTwoFactor){this.store.setState('owner-totp','null');this.store.setState('owner-totp-pending','null');}
      this.advanceSecurity();this.store.raw.prepare('UPDATE sessions SET expires=0').run();
      this.security.reset();this.security.succeeded('access',network);
      this.security.record(grant.mode==='initialize'?'account-initialized':'account-recovered',network);
      return {ok:true as const,username:value.username,adminPath:this.adminPath()};
    });
  }
  private profile():{username:string;displayName:string} { return JSON.parse(this.store.state('owner-profile') ?? '{"username":"owner","displayName":"站主"}'); }
  private advanceSecurity() { this.store.setState('owner-security', randomBytes(16).toString('hex')); }
  private assertCredentials(value: { stored: string; security: string | null }) {
    if (this.store.state('owner') !== value.stored || this.store.state('owner-security') !== value.security)
      throw new WeavaError('账户已变化，请重新验证。', 409);
  }
  private factor() { return JSON.parse(this.store.state('owner-totp') ?? 'null') as { secret: string; lastStep: number; recovery: string[] } | null; }
  private async credentials(password: string, network: string, code = '', username?: string, scope:'login'|'account'='account', complete=true) {
    if (password.length > 1024) throw new WeavaError('密码过长。', 400);
    const stored = this.store.state('owner');
    const security = this.store.state('owner-security');
    if (!stored) throw new WeavaError('请先设置站主密码。', 403);
    if (this.loginInFlight >= 2) throw new WeavaError('登录请求较多，请稍后重试。', 429, {retryAfter:1,retryAt:Date.now()+1000});
    this.security.reserve(scope,network);
    const [salt, hash] = stored.split(':');
    this.loginInFlight++;
    let actual: Buffer;
    try {
      actual = await new Promise<Buffer>((resolve, reject) =>
        scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key))),
      );
    } finally {
      this.loginInFlight--;
    }
    const expected = Buffer.from(hash, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || (username !== undefined && username !== this.profile().username)) {
      this.security.failed(scope,network);
      throw new WeavaError('账号或密码不正确。', 401);
    }
    if (this.store.state('owner') !== stored || this.store.state('owner-security') !== security)
      throw new WeavaError('密码已重置，请使用新密码登录。', 401);
    try { this.verifyFactor(code); } catch (error) {
      if (error instanceof WeavaError && error.status === 401) this.security.failed(scope,network);
      throw error;
    }
    if(complete)this.security.succeeded(scope,network);
    return { stored, security };
  }
  private verifyFactor(code: string) {
    const factor = this.factor(); if (!factor) return;
    const cleaned = code.trim().replace(/[\s-]/g, '').toUpperCase();
    this.store.raw.transaction(() => {
      const current = this.factor(); if (!current || current.secret !== factor.secret) throw new WeavaError('账户验证设置已变化，请重新验证。', 409);
      const step = totpStep(openSecret(this.root, current.secret), cleaned);
      if (step !== null && step > current.lastStep) current.lastStep = step;
      else {
        const index = current.recovery.indexOf(digest(cleaned));
        if (index < 0) throw new WeavaError('请输入有效且未使用的验证码或恢复码。', 401, { requiresCode: true });
        current.recovery.splice(index, 1);
        this.security.record('recovery-code-used');
      }
      this.store.setState('owner-totp', JSON.stringify(current));
    }).immediate();
  }
  async login(password: string, network = 'local', options: { code?: string; username?: string; userAgent?: string } = {}) {
    const verified = await this.credentials(password, network, options.code, options.username,'login');
    const token = randomBytes(32).toString('hex');
    this.store.raw.transaction(() => {
      this.assertCredentials(verified);
      this.store.raw.prepare('INSERT INTO sessions(token,expires) VALUES(?,?)').run(digest(token), Date.now() + 7 * 86400000);
      this.store.raw.prepare('INSERT INTO owner_sessions VALUES(?,?,?,?)').run(digest(token), Date.now(), Date.now(), (options.userAgent ?? '').slice(0, 300));
      this.store.raw.prepare('UPDATE sessions SET expires=0 WHERE token IN (SELECT token FROM sessions WHERE expires>? ORDER BY expires DESC LIMIT -1 OFFSET 20)').run(Date.now());
      this.security.record('login-succeeded',network);
    }).immediate();
    return token;
  }
  authenticate(token: string) {
    const authenticated = !!this.store.raw
      .prepare('SELECT 1 FROM sessions WHERE token=? AND expires>?')
      .get(digest(token), Date.now());
    if (authenticated) this.store.raw.prepare('UPDATE owner_sessions SET last_seen=? WHERE token=? AND last_seen<?').run(Date.now(), digest(token), Date.now() - 60000);
    return authenticated;
  }
  logout(token: string) {
    if (this.store.raw.prepare('UPDATE sessions SET expires=0 WHERE token=? AND expires>?').run(digest(token),Date.now()).changes)
      this.security.record('logout');
  }
  cliToken() {
    return readFileSync(join(this.root, 'cli-token'), 'utf8');
  }
  account(token: string) {
    return { ...this.profile(), adminPath:this.adminPath(), twoFactorEnabled: !!this.factor(), recoveryCodesRemaining: this.factor()?.recovery.length ?? 0,
      events:this.security.events(),
      sessions: (this.store.raw.prepare('SELECT s.token id,s.expires,d.created_at createdAt,d.last_seen lastSeen,d.user_agent userAgent FROM sessions s LEFT JOIN owner_sessions d ON s.token=d.token WHERE s.expires>? ORDER BY s.expires DESC').all(Date.now()) as any[])
        .map(row => { const ua = new UAParser(row.userAgent ?? '').getResult(); return { id: row.id, createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null, lastSeen: row.lastSeen ? new Date(row.lastSeen).toISOString() : null, expiresAt:new Date(row.expires).toISOString(),browser:ua.browser.name??'未知浏览器',os:ua.os.name??'未知系统',userAgent: row.userAgent ?? '旧登录会话', current: row.id === digest(token) }; }) };
  }
  async updateAccount(password: string|undefined, network: string, value: { username: string; displayName: string; newPassword?: string; code?: string }) {
    validateOwnerName(value.username);
    if (!value.displayName.trim() || value.displayName.length > 80) throw new WeavaError('显示名需要 1～80 个字符。');
    if (value.newPassword) validateOwnerPassword(value.newPassword,value.username);
    const renamed = this.profile().username !== value.username;
    const verified=renamed||value.newPassword?await this.credentials(password??'',network,value.code):undefined;
    this.store.raw.transaction(() => {
      if(verified)this.assertCredentials(verified);
      else if(this.profile().username!==value.username)throw new WeavaError('账户名已变化，请重新读取账户。',409);
      this.store.setState('owner-profile', JSON.stringify({ username: value.username, displayName: value.displayName.trim() }));
      if (value.newPassword) this.setOwner(value.newPassword,'browser',network);
      else if (renamed) { this.advanceSecurity(); this.store.raw.prepare('UPDATE sessions SET expires=0').run(); }
      this.security.record('account-updated',network);
    }).immediate();
    return { ok: true as const, loginRequired: !!value.newPassword || renamed };
  }
  async revokeSessions(password: string, network: string, id: string, token: string, code?: string) {
    const verified = await this.credentials(password, network, code);
    this.assertCredentials(verified);
    if (id === 'others') this.store.raw.prepare('UPDATE sessions SET expires=0 WHERE token<>?').run(digest(token));
    else this.store.raw.prepare('UPDATE sessions SET expires=0 WHERE token=?').run(id);
    this.security.record('sessions-revoked',network);
    return { ok: true as const };
  }
  async beginTwoFactor(password: string, network: string) {
    const verified = await this.credentials(password, network);
    this.assertCredentials(verified);
    if (this.factor()) throw new WeavaError('两步验证已经启用。');
    const secret = newTotpSecret();
    this.store.setState('owner-totp-pending', JSON.stringify({ secret: sealSecret(this.root, secret), expires: Date.now() + 600000 }));
    return { secret, uri: 'otpauth://totp/' + encodeURIComponent('Weava:' + this.profile().username) + '?secret=' + secret + '&issuer=Weava&algorithm=SHA1&digits=6&period=30' };
  }
  async confirmTwoFactor(password: string, network: string, code: string) {
    const verified = await this.credentials(password, network, '', undefined, 'account', false);
    const pending = JSON.parse(this.store.state('owner-totp-pending') ?? 'null');
    const step = pending && pending.expires > Date.now() ? totpStep(openSecret(this.root, pending.secret), code.trim()) : null;
    if (step === null) {this.security.failed('account',network);throw new WeavaError('验证码无效或设置已过期，请重新设置。');}
    const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(10).toString('hex').toUpperCase());
    this.store.raw.transaction(() => {
      this.assertCredentials(verified);
      if (this.store.state('owner-totp-pending') !== JSON.stringify(pending)) throw new WeavaError('两步验证设置已变化，请重新设置。', 409);
      if (this.factor()) throw new WeavaError('两步验证设置已变化。', 409);
      this.store.setState('owner-totp', JSON.stringify({ secret: pending.secret, lastStep: step, recovery: recoveryCodes.map(value => digest(value)) }));
      this.store.setState('owner-totp-pending', 'null');
      this.advanceSecurity();
      this.store.raw.prepare('UPDATE sessions SET expires=0').run();
      this.security.record('two-factor-enabled',network);
      this.security.succeeded('account',network);
    }).immediate();
    return { recoveryCodes };
  }
  async disableTwoFactor(password: string, network: string, code: string) {
    const verified = await this.credentials(password, network, code); this.assertCredentials(verified); this.resetTwoFactor('browser',network); return { ok: true as const };
  }
  resetTwoFactor(source:'browser'|'cli'='cli',network='') {
    this.store.raw.transaction(() => {
      this.store.setState('owner-totp', 'null'); this.store.setState('owner-totp-pending', 'null');
      this.advanceSecurity();
      this.store.raw.prepare('UPDATE sessions SET expires=0').run();
      this.security.record(source==='cli'?'two-factor-reset':'two-factor-disabled',network,source);
    }).immediate();
  }
  adminPath() { return this.store.state('owner-admin-path') ?? '/admin'; }
  retiredAdminPaths():string[] { return JSON.parse(this.store.state('owner-retired-admin-paths') ?? '[]'); }
  setAdminPath(path:string,source:'browser'|'cli'='cli',network='') {
    validateAdminPath(path);
    const raw=this.store.raw.prepare('SELECT data FROM releases WHERE id=?').get(this.store.state('release')??'') as {data:string}|undefined;
    const release=raw?loadRelease(this.store.raw,raw.data):null;
    const overlaps=(value:string)=>value.replace(/\/$/,'')===path||value.startsWith(path+'/');
    if (this.store.list('entry').some(row => overlaps(row.value.path??'')) || this.store.list('redirect').some(row=>overlaps(row.id)) ||
      release?.entries.some(entry=>overlaps(entry.path)) || Object.keys(release?.redirects??{}).some(overlaps))
      throw new WeavaError('后台地址与现有内容或跳转地址冲突。');
    const previous=this.adminPath();
    if(path!==previous)this.store.raw.transaction(()=>{
      this.store.setState('owner-retired-admin-paths',JSON.stringify([...new Set([...this.retiredAdminPaths(),previous])].filter(item=>item!==path)));
      this.store.setState('owner-admin-path',path);
      this.security.record('admin-path-changed',network,source);
    }).immediate();
    return {adminPath:path};
  }
  async changeAdminPath(password:string,network:string,path:string,code?:string) {
    const verified=await this.credentials(password,network,code);this.assertCredentials(verified);return this.setAdminPath(path,'browser',network);
  }
  rotateCliToken(revokeSessions=false,source:'browser'|'cli'='cli',network='') {
    const token=randomBytes(32).toString('hex'),path=join(this.root,'cli-token');
    const pending=path+'.pending-'+randomBytes(8).toString('hex');
    writeFileSync(pending,token,{flag:'wx',mode:0o600});renameSync(pending,path);
    if(revokeSessions)this.store.raw.transaction(()=>{this.advanceSecurity();this.store.raw.prepare('UPDATE sessions SET expires=0').run();}).immediate();
    this.security.record('cli-token-rotated',network,source);
    return {updated:true as const,loginRequired:revokeSessions};
  }
  async rotateCredentials(password:string,network:string,revokeSessions:boolean,code?:string) {
    const verified=await this.credentials(password,network,code);this.assertCredentials(verified);return this.rotateCliToken(revokeSessions,'browser',network);
  }
  recoverAccount(username:string,password:string,options:{resetTwoFactor?:boolean;rotateCliToken?:boolean}={}) {
    validateOwnerName(username);validateOwnerPassword(password,username);
    this.store.raw.transaction(()=>{
      this.store.setState('owner-profile',JSON.stringify({...this.profile(),username}));this.setOwner(password);
      if(options.resetTwoFactor)this.resetTwoFactor();
      this.security.record('account-recovered','','cli');
    }).immediate();
    if(options.rotateCliToken)this.rotateCliToken(true);
    return {updated:true,username,loginRequired:true,cliTokenRotated:!!options.rotateCliToken};
  }
  async renewRecoveryCodes(password:string,network:string,code:string) {
    const verified=await this.credentials(password,network,code);
    const recoveryCodes=Array.from({length:10},()=>randomBytes(10).toString('hex').toUpperCase());
    this.store.raw.transaction(()=>{
      this.assertCredentials(verified);const factor=this.factor();if(!factor)throw new WeavaError('请先启用两步验证。');
      factor.recovery=recoveryCodes.map(value=>digest(value));this.store.setState('owner-totp',JSON.stringify(factor));
      this.advanceSecurity();this.store.raw.prepare('UPDATE sessions SET expires=0').run();
      this.security.record('recovery-codes-renewed',network);
    }).immediate();
    return {recoveryCodes};
  }
}
