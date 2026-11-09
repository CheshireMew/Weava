import { expect,it,vi } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Site } from '../packages/core/src/site.ts';
import { totpCode,totpStep } from '../packages/core/src/two-factor.ts';
import { createBackup,copyVerifiedBackup } from '../packages/core/src/backup.ts';
const base=(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests')+'/owner-'+Date.now();
const password='owner-password-for-test';
function create(name:string){const site=new Site(join(base,name));site.setOwner(password);return site;}

it('verifies RFC 6238 six-digit codes and the bounded clock window',()=>{
  const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  expect(totpCode(secret,1)).toBe('287082');
  expect(totpCode(secret,37037036)).toBe('081804');
  expect(totpStep(secret,'287082',59000)).toBe(1);
  expect(totpStep(secret,'287082',120000)).toBeNull();
});
it('changes the single owner identity and password only after proof, revoking old sessions',async()=>{
  const site=create('identity');try{
    const first=await site.login(password,'a',{userAgent:'browser-a'}),second=await site.login(password,'b');
    const account=site.auth.account(first);expect(account.username).toBe('owner');expect(account.sessions).toHaveLength(2);
    expect(JSON.stringify(account)).not.toContain(first);expect(JSON.stringify(account)).not.toContain(second);
    await expect(site.auth.updateAccount('wrong','c',{username:'owner',displayName:'Name',newPassword:'attempted-owner-password'})).rejects.toMatchObject({status:401});
    expect(site.authenticate(first)).toBe(true);
    await site.auth.revokeSessions(password,'d','others',first);expect(site.authenticate(second)).toBe(false);expect(site.authenticate(first)).toBe(true);
    expect(await site.auth.updateAccount(password,'e',{username:'nico',displayName:'Nico',newPassword:'new-owner-password'})).toEqual({ok:true,loginRequired:true});
    expect(site.authenticate(first)).toBe(false);
    await expect(site.login(password,'f')).rejects.toMatchObject({status:401});
    await expect(site.login('new-owner-password','g',{username:'owner'})).rejects.toMatchObject({status:401});
    const current=await site.login('new-owner-password','h',{username:'nico'});expect(site.auth.account(current).displayName).toBe('Nico');
  }finally{site.close();}
});
it('reports a username-only change as requiring a fresh login',async()=>{
  const site=create('rename');try{
    const token=await site.login(password);
    expect((await site.auth.updateAccount(password,'rename',{username:'newname',displayName:'Name'})).loginRequired).toBe(true);
    expect(site.authenticate(token)).toBe(false);
  }finally{site.close();}
});
it('bounds sensitive-operation attempts separately from login attempts',async()=>{
  const site=create('sensitive-limits');try{
    for(let i=0;i<5;i++)await expect(site.auth.updateAccount('wrong','same-network',{username:'changed-owner',displayName:'Owner'})).rejects.toMatchObject({status:401});
    await expect(site.auth.updateAccount(password,'same-network',{username:'changed-owner',displayName:'Owner'})).rejects.toMatchObject({status:429});
    expect(site.authenticate(await site.login(password,'same-network'))).toBe(true);
  }finally{site.close();}
});
it('updates an ordinary display name without another password or revoking the authenticated session',async()=>{
 const site=create('display-name');try{
  const token=await site.login(password);
  expect(await site.auth.updateAccount(undefined,'profile',{username:'owner',displayName:'New name'})).toEqual({ok:true,loginRequired:false});
  expect(site.auth.account(token).displayName).toBe('New name');expect(site.authenticate(token)).toBe(true);
  await expect(site.auth.updateAccount(undefined,'sensitive',{username:'renamed',displayName:'New name'})).rejects.toMatchObject({status:401});
 }finally{site.close();}
});
it('confirms setup before enabling, prevents replay, consumes recovery once, and supports offline reset',async()=>{
  const site=create('totp'),clock=vi.spyOn(Date,'now').mockReturnValue(1800000000000);
  try{
    const token=await site.login(password,'before');
    const setup=await site.auth.beginTwoFactor(password,'begin');
    expect(setup.uri).toContain(setup.secret);expect(site.auth.account(token).twoFactorEnabled).toBe(false);
    const wrong=(Number(totpCode(setup.secret))+100).toString().padStart(6,'0');
    await expect(site.auth.confirmTwoFactor(password,'wrong',wrong)).rejects.toThrow('验证码');
    const {recoveryCodes}=await site.auth.confirmTwoFactor(password,'confirm',totpCode(setup.secret));
    expect(recoveryCodes).toHaveLength(10);expect(site.authenticate(token)).toBe(false);
    const raw=site.store.state('owner-totp')!;expect(raw).not.toContain(setup.secret);expect(raw).not.toContain(recoveryCodes[0]);
    await expect(site.login(password,'no-code')).rejects.toMatchObject({status:401});
    await expect(site.login(password,'replay',{code:totpCode(setup.secret)})).rejects.toMatchObject({status:401});
    const logged=await site.login(password,'recovery',{code:recoveryCodes[0]});expect(site.authenticate(logged)).toBe(true);
    await expect(site.login(password,'reuse',{code:recoveryCodes[0]})).rejects.toMatchObject({status:401});
    clock.mockReturnValue(1800000030000);
    await site.login(password,'next',{code:totpCode(setup.secret)});
    expect(site.auth.account(logged).recoveryCodesRemaining).toBe(9);
    site.auth.resetTwoFactor();expect(site.authenticate(logged)).toBe(false);
    expect(site.authenticate(await site.login(password,'reset'))).toBe(true);
  }finally{clock.mockRestore();site.close();}
});
it('does not issue a session when a password changes during password verification',async()=>{
  const site=create('race');try{
    const pending=site.login(password,'race');site.setOwner('replacement-password');
    await expect(pending).rejects.toMatchObject({status:401});
    expect(site.auth.account('').sessions).toHaveLength(0);
  }finally{site.close();}
});
it('upgrades a version five database without invalidating its existing session',async()=>{
  const root=join(base,'legacy'),site=create('legacy');const token=await site.login(password);site.close();
  const db=new Database(join(root,'weava.sqlite'));db.exec('DROP TABLE owner_sessions; DROP TABLE owner_security_events; DROP TABLE owner_auth_failures; DELETE FROM schema_migrations WHERE version>=6;');db.close();
  const upgraded=new Site(root,{mode:'migrate'});try{expect(upgraded.authenticate(token)).toBe(true);expect(upgraded.auth.account(token).sessions[0].current).toBe(true);}finally{upgraded.close();}
});
it('includes the encryption key in a complete backup and restores working recovery codes',async()=>{
  const site=create('backup');let backup;try{
    const setup=await site.auth.beginTwoFactor(password,'setup');const codes=await site.auth.confirmTwoFactor(password,'confirm',totpCode(setup.secret));
    backup=await createBackup(site,join(base,'backups'));
    expect(JSON.parse(readFileSync(join(backup.path,'manifest.json'),'utf8')).files.some((file:any)=>file.path==='account.key')).toBe(true);
    const target=join(base,'restored');copyVerifiedBackup(backup.path,target);
    const restored=new Site(target);try{const token=await restored.login(password,'restored',{code:codes.recoveryCodes[0]});expect(restored.authenticate(token)).toBe(true);}finally{restored.close();}
  }finally{site.close();}
});
