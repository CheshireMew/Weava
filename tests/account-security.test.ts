import { afterEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { writeFileSync,readFileSync } from 'node:fs';
import { Site } from '../packages/core/src/site.ts';
import { entrySchema, WeavaError } from '@weava/contracts';
import { validateOwnerPassword } from '../packages/core/src/password-policy.ts';
import { validateAdminPath,isAdminPage } from '../packages/core/src/admin-access.ts';
import { passwordFromFile } from '../packages/cli/src/owner-input.ts';
import { totpCode } from '../packages/core/src/two-factor.ts';
import { authorized } from '../apps/web/src/api/transport.ts';
import { adminApi } from '@weava/contracts/api';
import { createAdminClient } from '@weava/contracts/api-client';
import { OwnerSecurity } from '../packages/core/src/owner-security.ts';
import QRCode from 'qrcode';
import { Engagement } from '../packages/core/src/engagement.ts';

const base='D:/Tools/cache/weava/tests/account-security-'+Date.now();
const password='violet river lantern 2026!';
const sites:Site[]=[];
let sequence=0;
function fixture(){const site=new Site(join(base,String(sequence++)));sites.push(site);return site;}
afterEach(()=>{vi.restoreAllMocks();sites.splice(0).forEach(site=>site.close());});
it('has no initial password and applies the same policy to initialization, recovery and account updates',async()=>{
  const site=fixture();expect(site.ownerExists()).toBe(false);
  await expect(site.login('admin123')).rejects.toMatchObject({status:403});
  for(const weak of ['short','aaaaaaaaaaaaaaa','password1234567890!','12345678901234567890','owner1234567890123']){
    expect(()=>site.setOwner(weak)).toThrow();expect(()=>site.auth.recoverAccount('owner',weak)).toThrow();
  }
  site.setOwner(password);const token=await site.login(password);
  await expect(site.auth.updateAccount(password,'update',{username:'owner',displayName:'Owner',newPassword:'aaaaaaaaaaaaaaa'})).rejects.toThrow();
  expect(site.authenticate(token)).toBe(true);
  expect(()=>validateOwnerPassword('  秋天的河流 配上紫色灯笼 2026!  ','nico')).not.toThrow();
});
it('preserves password whitespace and Unicode through files and recovery',async()=>{
  const site=fixture(),value='  秋天的河流 配上紫色灯笼 2026!  ',file=join(site.root,'password-fixture.txt');
  writeFileSync(file,'\ufeff'+value+'\r\n');expect(passwordFromFile(file)).toBe(value);
  site.auth.recoverAccount('nico',passwordFromFile(file));
  expect(site.authenticate(await site.login(value,'ok',{username:'nico'}))).toBe(true);
  await expect(site.login(value.trim(),'bad',{username:'nico'})).rejects.toMatchObject({status:401});
});
it('retains valid pre-policy passwords until the owner explicitly changes them',async()=>{
  const site=fixture();site.setOwner(password);
  const {scryptSync}=await import('node:crypto');site.store.setState('owner','legacy-salt:'+scryptSync('old-short','legacy-salt',64).toString('hex'));
  expect(site.authenticate(await site.login('old-short'))).toBe(true);
});
it('renews recovery codes atomically, invalidates old codes and all sessions, and never logs secrets',async()=>{
  const clock=vi.spyOn(Date,'now').mockReturnValue(1800000000000),site=fixture();site.setOwner(password);
  const initial=await site.auth.beginTwoFactor(password,'setup');const first=await site.auth.confirmTwoFactor(password,'confirm',totpCode(initial.secret));
  const token=await site.login(password,'login',{code:first.recoveryCodes[0]});
  const second=await site.auth.renewRecoveryCodes(password,'renew',first.recoveryCodes[1]);
  expect(site.authenticate(token)).toBe(false);expect(second.recoveryCodes).toHaveLength(10);
  await expect(site.login(password,'old-code',{code:first.recoveryCodes[2]})).rejects.toMatchObject({status:401});
  const current=await site.login(password,'new-code',{code:second.recoveryCodes[0]});expect(site.authenticate(current)).toBe(true);
  await expect(site.login(password,'reuse',{code:second.recoveryCodes[0]})).rejects.toMatchObject({status:401});
  const account=site.auth.account(current),serialized=JSON.stringify(account.events);
  for(const secret of [password,initial.secret,current,...first.recoveryCodes,...second.recoveryCodes])expect(serialized).not.toContain(secret);
  expect(account.events.map(event=>event.event)).toContain('recovery-codes-renewed');
  const stored=site.store.state('owner-totp')!;expect(stored).not.toContain(second.recoveryCodes[1]);clock.mockRestore();
});
it('creates a local QR image from the standard authenticator URI',async()=>{
  const site=fixture();site.setOwner(password);const setup=await site.auth.beginTwoFactor(password,'qr');
  const image=await QRCode.toDataURL(setup.uri,{width:208,margin:2,errorCorrectionLevel:'M'});
  expect(image).toMatch(/^data:image\/png;base64,/);expect(QRCode.create(setup.uri).modules.size).toBeGreaterThan(20);
});
it('requires identity proof before changing paths or rotating external credentials',async()=>{
  const site=fixture();site.setOwner(password);const oldToken=site.cliToken();
  await expect(site.auth.changeAdminPath('wrong','path','/manage-nico')).rejects.toMatchObject({status:401});
  await expect(site.auth.rotateCredentials('wrong','rotate',true)).rejects.toMatchObject({status:401});
  expect(site.auth.adminPath()).toBe('/admin');expect(site.cliToken()).toBe(oldToken);
});
it('rotates external credentials immediately, optionally keeps browser sessions, and supports complete recovery',async()=>{
  const site=fixture();site.setOwner(password);const token=await site.login(password),old=site.cliToken();
  await site.auth.rotateCredentials(password,'rotate',false);const newer=site.cliToken();expect(newer).not.toBe(old);expect(site.authenticate(token)).toBe(true);
  const context=(credential:string)=>({cookies:{get:()=>undefined},request:new Request('https://example.test/api',{headers:{Authorization:'Bearer '+credential}})} as any);
  expect(authorized({site},context(old))).toBe(false);expect(authorized({site},context(newer))).toBe(true);
  site.auth.recoverAccount('nico','new meadow lantern phrase!',{resetTwoFactor:true,rotateCliToken:true});
  expect(site.authenticate(token)).toBe(false);expect(authorized({site},context(newer))).toBe(false);
  expect(site.auth.account('').username).toBe('nico');expect(site.auth.account('').twoFactorEnabled).toBe(false);
  expect(site.authenticate(await site.login('new meadow lantern phrase!','recovered',{username:'nico'}))).toBe(true);
});
it('privately persists the real admin path and refuses collisions and invalid paths',async()=>{
  const site=fixture();site.setOwner(password);
  for(const invalid of ['/api','//other.test','/a','/admin?x','/admin/#x','/media','/a/b'])expect(()=>validateAdminPath(invalid)).toThrow();
  await site.auth.changeAdminPath(password,'path','/manage-nico');
  expect(site.auth.adminPath()).toBe('/manage-nico');expect(site.auth.retiredAdminPaths()).toContain('/admin');
  expect(isAdminPage('/manage-nico/',site.auth.adminPath())).toBe(true);expect(isAdminPage('/admin',site.auth.adminPath())).toBe(false);
  expect(JSON.stringify(site.settings())).not.toContain('/manage-nico');
  expect(()=>site.saveEntry(entrySchema.parse({id:'collision',kind:'page',path:'/manage-nico/child/',title:'No'}),null)).toThrow();
  site.saveEntry(entrySchema.parse({id:'used',kind:'page',path:'/already-used/',title:'Used'}),null);
  expect(()=>site.auth.setAdminPath('/already-used')).toThrow();
});
it('returns increasing waits, persists throttles across reopen, and separates account attempts from login',async()=>{
  const site=fixture();site.setOwner(password);const clock=vi.spyOn(Date,'now').mockReturnValue(1800000000100);
  for(let i=0;i<5;i++)await expect(site.login('wrong','client')).rejects.toMatchObject({status:401});
  await expect(site.login(password,'client')).rejects.toMatchObject({status:429,details:{retryAfter:2}});
  clock.mockReturnValue(1800000002101);await expect(site.login('wrong','client')).rejects.toMatchObject({status:401});
  await expect(site.login(password,'client')).rejects.toMatchObject({status:429,details:{retryAfter:4}});
  site.close();sites.pop();const reopened=new Site(site.root);sites.push(reopened);
  await expect(reopened.login(password,'client')).rejects.toMatchObject({status:429});
  await expect(reopened.auth.updateAccount(password,'client',{username:'owner',displayName:'Name'})).resolves.toMatchObject({ok:true});
  clock.mockReturnValue(1800000006102);expect(reopened.authenticate(await reopened.login(password,'client'))).toBe(true);
});
it('bounds distributed failures and expires them rather than permanently locking the account',async()=>{
  const site=fixture(),clock=vi.spyOn(Date,'now').mockReturnValue(1800000000000),security=new OwnerSecurity(site.store);
  for(let i=0;i<30;i++){security.reserve('login','source-'+i);security.failed('login','source-'+i);}
  expect(()=>security.reserve('login','next-source')).toThrow(WeavaError);
  clock.mockReturnValue(1800000600001);expect(()=>security.reserve('login','next-source')).not.toThrow();
});
it('shows readable device information and expiration without revealing session credentials',async()=>{
  const site=fixture();site.setOwner(password);const token=await site.login(password,'device',{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'});
  const account=adminApi.account.response.parse(site.auth.account(token));expect(account.sessions[0]).toMatchObject({browser:'Chrome',os:'Windows',current:true});
  expect(new Date(account.sessions[0].expiresAt).getTime()).toBeGreaterThan(Date.now());expect(JSON.stringify(account)).not.toContain(token);
  site.logout(token);expect(site.authenticate(token)).toBe(false);
});
it('carries Retry-After to clients without replaying the request',async()=>{
  let calls=0;const client=createAdminClient({fetch:async()=>{calls++;return Response.json({error:'Wait',details:{retryAt:1800000002000}},{status:429,headers:{'Retry-After':'2'}});}});
  await expect(client('login',{password})).rejects.toMatchObject({status:429,retryAfter:2});expect(calls).toBe(1);
});
it('keeps security records bounded and contains only approved event fields',()=>{
  const site=fixture(),security=new OwnerSecurity(site.store);
  for(let i=0;i<1010;i++)security.record('login-failed','untrusted-input-password');
  expect(site.store.raw.prepare('SELECT count(*) n FROM owner_security_events').get()).toEqual({n:1000});
  expect(security.events()).toHaveLength(100);expect(JSON.stringify(security.events())).not.toContain('untrusted-input');
});
it('preserves existing reader identities when the CLI credential is rotated and the site restarts',()=>{
  const site=fixture(),key=site.engagementSecret(),reader='a'.repeat(64);
  const before=new Engagement(site.store.raw,key);before.setLike('article',reader,true,'network');
  expect(before.summary('article',reader).liked).toBe(true);
  site.auth.rotateCliToken();expect(site.cliToken()).not.toBe(key);site.close();sites.pop();
  const reopened=new Site(site.root);sites.push(reopened);expect(reopened.engagementSecret()).toBe(key);
  expect(new Engagement(reopened.store.raw,reopened.engagementSecret()).summary('article',reader).liked).toBe(true);
});
it('counts invalid authenticator setup codes toward the progressive wait',async()=>{
  const site=fixture();site.setOwner(password);const setup=await site.auth.beginTwoFactor(password,'begin');
  const wrong=(Number(totpCode(setup.secret))+100).toString().padStart(6,'0');
  for(let i=0;i<5;i++)await expect(site.auth.confirmTwoFactor(password,'bad-setup',wrong)).rejects.toThrow('验证码');
  await expect(site.auth.confirmTwoFactor(password,'bad-setup',totpCode(setup.secret))).rejects.toMatchObject({status:429});
});
it('rejects a login already verifying its password when all credentials are revoked',async()=>{
  const site=fixture();site.setOwner(password);const pending=site.login(password,'pending');site.auth.rotateCliToken(true);
  await expect(pending).rejects.toMatchObject({status:401});expect(site.auth.account('').sessions).toHaveLength(0);
});
