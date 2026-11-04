import { afterEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Site } from '../packages/core/src/site.ts';
import { OwnerAccessLinks, OWNER_ACCESS_TTL, ownerAccessUrl } from '../packages/core/src/owner-access-links.ts';
import { localOwnerLink, localOwnerStatus, announceOwnerAccess,checkedLocalOwnerLink } from '../packages/cli/src/owner-links.ts';
import { totpCode } from '../packages/core/src/two-factor.ts';
import { entrySchema } from '@weava/contracts';
const base='D:/Tools/cache/weava/tests/owner-links-'+Date.now(),sites:Site[]=[];let sequence=0;
const password='violet meadow lantern phrase!',nextPassword='silver mountain library phrase!';
function fixture(){const site=new Site(join(base,String(sequence++)));sites.push(site);writeFileSync(join(site.root,'site.json'),JSON.stringify({port:4322}));return site;}
function body(username='nico',value=password){return {username,password:value,confirmPassword:value};}
afterEach(()=>{vi.restoreAllMocks();sites.splice(0).forEach(site=>site.close());});
it('issues an opaque limited link locally without initializing an account or creating a login',()=>{
  const site=fixture(),grant=localOwnerLink(site.root,'initialize'),token=new URL(grant.url).hash.split('=')[1];
  expect(site.ownerExists()).toBe(false);expect(site.authenticate(token)).toBe(false);
  expect(site.auth.accessInfo(token,'viewer')).toMatchObject({mode:'initialize',username:'owner'});
  expect(site.store.state('owner-access-link')).not.toContain(token);expect(grant.url).toContain('/admin/#owner-access=');
  expect(new URL(grant.url).search).toBe('');expect(localOwnerStatus(site.root)).not.toHaveProperty('token');
});
it('invalidates replaced, expired, unknown and wrong-purpose grants',()=>{
  const site=fixture(),links=new OwnerAccessLinks(site.store.raw),clock=vi.spyOn(Date,'now').mockReturnValue(1800000000000);
  expect(()=>links.issue('reset')).toThrow();const first=links.issue('initialize'),second=links.issue('initialize');
  expect(()=>links.inspect(first.token)).toThrow();expect(()=>links.inspect('a'.repeat(64))).toThrow();expect(()=>links.inspect('')).toThrow();
  expect(links.inspect(second.token).mode).toBe('initialize');clock.mockReturnValue(1800000000000+OWNER_ACCESS_TTL);
  expect(()=>links.inspect(second.token)).toThrow();site.setOwner(password);expect(()=>links.issue('initialize')).toThrow();
});
it('leaves a valid link and existing credentials unchanged when validation fails',async()=>{
  const site=fixture();site.setOwner(password);const token=await site.login(password),link=new OwnerAccessLinks(site.store.raw).issue('reset');
  await expect(site.auth.completeAccess(link.token,'submit',{...body(),confirmPassword:'different'})).rejects.toThrow('不一致');
  await expect(site.auth.completeAccess(link.token,'submit',body('bad account'))).rejects.toThrow();
  await expect(site.auth.completeAccess(link.token,'submit',body('nico','short'))).rejects.toThrow();
  expect(site.authenticate(token)).toBe(true);expect(site.auth.accessInfo(link.token,'viewer').mode).toBe('reset');
  expect(site.authenticate(await site.login(password,'unchanged'))).toBe(true);
});
it('initializes the chosen account once without granting a full session to the setup token',async()=>{
  const site=fixture(),grant=new OwnerAccessLinks(site.store.raw).issue('initialize');
  expect(await site.auth.completeAccess(grant.token,'complete',body())).toEqual({ok:true,username:'nico',adminPath:'/admin'});
  expect(site.auth.account('').sessions).toHaveLength(0);expect(site.authenticate(grant.token)).toBe(false);
  await expect(site.auth.completeAccess(grant.token,'reuse',body('someone-else'))).rejects.toMatchObject({status:403});
  expect(site.authenticate(await site.login(password,'login',{username:'nico'}))).toBe(true);
});
it('atomically permits only one of two simultaneous submissions',async()=>{
  const site=fixture(),grant=new OwnerAccessLinks(site.store.raw).issue('initialize');
  const values=await Promise.allSettled([site.auth.completeAccess(grant.token,'one',body()),site.auth.completeAccess(grant.token,'two',body('other',nextPassword))]);
  expect(values.filter(value=>value.status==='fulfilled')).toHaveLength(1);expect(values.filter(value=>value.status==='rejected')).toHaveLength(1);
});
it('rechecks expiry after asynchronous password hashing and does not partially reset the account',async()=>{
  const clock=vi.spyOn(Date,'now').mockReturnValue(1800000000000),site=fixture();site.setOwner(password);
  const link=new OwnerAccessLinks(site.store.raw).issue('reset');const pending=site.auth.completeAccess(link.token,'pending',body('nico',nextPassword));
  clock.mockReturnValue(1800000000000+OWNER_ACCESS_TTL+1);await expect(pending).rejects.toMatchObject({status:403});
  expect(site.auth.account('').username).toBe('owner');expect(site.authenticate(await site.login(password,'old'))).toBe(true);
});
it('invalidates a pending link when credentials change through another recovery method',()=>{
  const site=fixture();site.setOwner(password);const links=new OwnerAccessLinks(site.store.raw),grant=links.issue('reset');
  site.setOwner(nextPassword);expect(()=>links.inspect(grant.token)).toThrow();
});
it('preserves content and settings while changing credentials and revoking every old session',async()=>{
  const site=fixture();site.setOwner(password);site.saveEntry(entrySchema.parse({id:'page',kind:'page',path:'/page/',title:'Keep content'}),null);
  const before=JSON.stringify(site.settings()),entry=JSON.stringify(site.store.get('entry','page')),token=await site.login(password),cli=site.cliToken();
  const grant=new OwnerAccessLinks(site.store.raw).issue('reset');expect(site.authenticate(token)).toBe(true);
  await site.auth.completeAccess(grant.token,'reset',body('nico',nextPassword));
  expect(site.authenticate(token)).toBe(false);expect(JSON.stringify(site.settings())).toBe(before);expect(JSON.stringify(site.store.get('entry','page'))).toBe(entry);expect(site.cliToken()).toBe(cli);
  await expect(site.login(password,'old')).rejects.toMatchObject({status:401});
  expect(site.authenticate(await site.login(nextPassword,'new',{username:'nico'}))).toBe(true);
  const events=JSON.stringify(site.auth.account('').events);for(const value of [grant.token,password,nextPassword])expect(events).not.toContain(value);
});
it('preserves two-factor authentication unless the local issuer explicitly authorizes its reset',async()=>{
  const clock=vi.spyOn(Date,'now').mockReturnValue(1800000000000),site=fixture();site.setOwner(password);
  const setup=await site.auth.beginTwoFactor(password,'setup');const codes=await site.auth.confirmTwoFactor(password,'confirm',totpCode(setup.secret));
  const links=new OwnerAccessLinks(site.store.raw),grant=links.issue('reset');await site.auth.completeAccess(grant.token,'reset',body('nico',nextPassword));
  expect(site.auth.account('').twoFactorEnabled).toBe(true);await expect(site.login(nextPassword,'no-factor',{username:'nico'})).rejects.toMatchObject({status:401});
  expect(site.authenticate(await site.login(nextPassword,'factor',{username:'nico',code:codes.recoveryCodes[0]}))).toBe(true);
  const reset=links.issue('reset',true);expect(links.inspect(reset.token).resetTwoFactor).toBe(true);await site.auth.completeAccess(reset.token,'reset-factor',body());
  expect(site.auth.account('').twoFactorEnabled).toBe(false);clock.mockRestore();
});
it('rejects invalid destinations before replacing the current link and never migrates an old database',()=>{
  const root=join(base,'minimal-'+sequence++);mkdirSync(root,{recursive:true});writeFileSync(join(root,'site.json'),JSON.stringify({port:4324}));
  const db=new Database(join(root,'weava.sqlite'));
  try{
    db.exec("CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);INSERT INTO schema_migrations VALUES(6);");
    const first=localOwnerLink(root,'initialize');expect(()=>localOwnerLink(root,'initialize','http://public.example')).toThrow();
    expect(new OwnerAccessLinks(db).inspect(new URL(first.url).hash.split('=')[1]).mode).toBe('initialize');
    expect(db.prepare('SELECT max(version) v FROM schema_migrations').get()).toEqual({v:6});
    for(const value of ['https://user:pass@example.com','https://example.com/path','https://example.com/?x=1','https://example.com/#x'])expect(()=>ownerAccessUrl(value,'/admin','token')).toThrow();
    expect(ownerAccessUrl('https://example.com','/admin','token')).toBe('https://example.com/admin/#owner-access=token');
  }finally{db.close();}
});
it('prints a setup link only for an uninitialized site and prints only account information on later startups',async()=>{
  const site=fixture(),messages:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({accountLinks:true})));
  try{
    await announceOwnerAccess(site.root,'4322',undefined,()=>true,text=>messages.push(text));
    expect(messages.join('\n')).toContain('#owner-access=');expect(messages.join('\n')).toContain('10 分钟');
    site.setOwner(password);messages.length=0;
    await announceOwnerAccess(site.root,'4322',undefined,()=>true,text=>messages.push(text));
    expect(messages.join('\n')).toContain('账户名：owner');expect(messages.join('\n')).not.toContain('#owner-access=');expect(messages.join('\n')).not.toContain(password);
  }finally{vi.unstubAllGlobals();}
});
it('refuses to hand out an unusable link while an older runtime is running',async()=>{
  const site=fixture();site.setOwner(password);writeFileSync(join(site.root,'runtime.json'),JSON.stringify({pid:process.pid,status:'running',port:4322}));
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({initialized:true})));
  try{await expect(checkedLocalOwnerLink(site.root,'reset')).rejects.toThrow('尚不支持');expect(site.store.state('owner-access-link')).toBeUndefined();}
  finally{vi.unstubAllGlobals();}
});
