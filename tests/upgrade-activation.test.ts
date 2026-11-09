import {afterEach,expect,it,vi} from 'vitest';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Site} from '@weava/core';
import {atomic,json,updateInstallation} from '../packages/manager/src/state.ts';
import {fixtureProgram} from './fixtures/managed-program.ts';
import {protectedUpgrade,recoverProtected} from '../packages/manager/src/upgrade.ts';
import {requestHost} from '../packages/manager/src/host.ts';
import {restoreCheckpoint} from '../packages/manager/src/operations.ts';
import {captureSeo} from '../packages/manager/src/seo-check.ts';

const state=vi.hoisted(()=>({program:null as any,site:null as any,root:'',failure:'',activated:false,recovering:false}));
vi.mock('../packages/manager/src/state.ts',async original=>({...await original<any>(),programFor:()=>state.program}));
vi.mock('../packages/manager/src/operations.ts',()=>({
  onlineWorkspace:async()=>{const root=join(state.root,'work');mkdirSync(root);return {root,stamp:'stable'};},checkWorkspace:async()=>({}),
  adoptSite:async(_home:string,root:string,_id:string,_program:string,_build:string,options:any)=>{const point=join(root,'checkpoint');atomic(join(root,'.weava-update.json'),{status:'switched',point,programId:'old',online:{operation:options.operation}});return {point};},
  restoreCheckpoint:vi.fn(()=>{const row=state.site.settings();state.site.saveSettings({...row.value,name:'Restored old data'},row.revision);}),
  withLease:async(_home:any,_root:any,_program:any,action:()=>unknown)=>action(),
}));
vi.mock('../packages/manager/src/public-inventory.ts',()=>({siteStamp:()=> 'stable',publicInventory:()=>({paths:['/'],domain:'https://fixture.example',redirects:[],dynamicRedirects:[]})}));
vi.mock('../packages/manager/src/seo-check.ts',()=>({upgradeProbePath:()=>'/probe',captureSeo:vi.fn(async(_options:any)=>({pages:{'/':{status:200}},robots:{status:200,text:'User-agent: *'}})),compareSeo:()=>({passed:true,differences:[]})}));
vi.mock('../packages/manager/src/probe-server.ts',()=>({probeServer:async()=>({origin:'http://probe',headers:{},stop:async()=>{}})}));
vi.mock('../packages/manager/src/host.ts',()=>({requestHost:vi.fn(async(_home:string,action:string)=>{
  if(action==='status')return {protocol:2,sites:[{id:'blog',status:'running'}]};
  if(action==='activate'){
    expect(json(join(state.root,'.weava-update.json')).writesEnabled).toBe(true);
    state.activated=true;const row=state.site.settings();state.site.saveSettings({...row.value,name:'Saved after activation'},row.revision);
    if(state.failure==='lost-reply'&&!state.recovering)throw new Error('activation reply lost');
  }
  return {};
})}));
afterEach(()=>{state.site?.close();vi.unstubAllGlobals();vi.clearAllMocks();});

it.each(['lost-reply','proxy-check'])('preserves writes after activation during %s and resumes without restoring a checkpoint',async failure=>{
  const base=process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests',home=join(base,'upgrade-activation-'+randomUUID()),root=join(home,'site');
  state.program=fixtureProgram(home);state.program.manifest.upgradeProtocol=2;state.root=root;state.site=new Site(root);state.failure=failure;state.activated=false;state.recovering=false;
  atomic(join(root,'site.json'),{version:2,id:'blog',port:4500,features:[],template:'blank'});atomic(join(root,'program.json'),{version:2,programId:'old',manifestHash:'a'.repeat(64),selectedAt:new Date().toISOString(),installationRoot:home});writeFileSync(join(root,'cli-token'),'fixture-token');
  updateInstallation(home,value=>{value.sites.blog={root,autostart:false,...(failure==='proxy-check'?{proxyOrigin:'http://proxy'}:{})};});
  vi.stubGlobal('fetch',vi.fn(async(input:string,init:RequestInit={})=>{
    const url=new URL(input);
    if(url.hostname==='proxy'){
      if(url.pathname==='/robots.txt')return new Response('User-agent: *');
      if(state.recovering)return new Response('ok');
      if(new Headers(init.headers).has('x-weava-maintenance-probe')&&!state.activated)return new Response('ok');
      return new Response('maintenance',{status:state.activated?502:503,headers:{'Retry-After':'60','Cache-Control':'no-store'}});
    }
    return new Response('ok');
  }));
  await expect(protectedUpgrade(home,root,'blog',state.program.manifest.id,undefined)).rejects.toThrow(/当前数据已保留/);
  const final=vi.mocked(captureSeo).mock.calls[2][0];
  expect(final.origin).toBe(failure==='proxy-check'?'http://proxy':'http://127.0.0.1:4500');
  if(failure==='proxy-check')expect(final.headers).toHaveProperty('x-weava-maintenance-probe');
  expect(state.site.settings().value.name).toBe('Saved after activation');expect(restoreCheckpoint).not.toHaveBeenCalled();
  expect(json(join(root,'.weava-update.json'))).toMatchObject({status:'activation-failed',writesEnabled:true});expect(existsSync(join(home,'proxy/blog/active.json'))).toBe(true);
  expect(vi.mocked(requestHost).mock.calls.filter(call=>call[1]==='stop')).toHaveLength(1);
  state.recovering=true;expect(await recoverProtected(home,root)).toMatchObject({recovered:true,dataPreserved:true});
  expect(state.site.settings().value.name).toBe('Saved after activation');expect(restoreCheckpoint).not.toHaveBeenCalled();expect(existsSync(join(home,'proxy/blog/active.json'))).toBe(false);
  await expect(recoverProtected(home,root)).rejects.toThrow(/restore-data/);
  expect(await recoverProtected(home,root,true)).toMatchObject({recovered:true});expect(state.site.settings().value.name).toBe('Restored old data');expect(restoreCheckpoint).toHaveBeenCalledTimes(1);
  expect(await recoverProtected(home,root)).toEqual({recovered:false,point:null});expect(state.site.settings().value.name).toBe('Restored old data');
});

it('stops before enabling writes and restores the checkpoint when the real public proxy fails validation',async()=>{
 const home=join(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests','upgrade-public-'+randomUUID()),root=join(home,'site');
 state.program=fixtureProgram(home);state.program.manifest.upgradeProtocol=2;state.root=root;state.site=new Site(root);state.failure='';state.activated=false;state.recovering=false;
 atomic(join(root,'site.json'),{version:2,id:'blog',port:4500,features:[],template:'blank'});atomic(join(root,'program.json'),{version:2,programId:'old',manifestHash:'a'.repeat(64),selectedAt:new Date().toISOString(),installationRoot:home});writeFileSync(join(root,'cli-token'),'fixture-token');
 updateInstallation(home,value=>{value.sites.blog={root,autostart:false,proxyOrigin:'http://proxy'};});
 vi.stubGlobal('fetch',vi.fn(async(input:string,init:RequestInit={})=>{
  if(new URL(input).hostname==='proxy'&&new URL(input).pathname!=='/robots.txt'&&!new Headers(init.headers).has('x-weava-maintenance-probe'))return new Response('maintenance',{status:503,headers:{'Retry-After':'60','Cache-Control':'no-store'}});
  return new Response(new URL(input).pathname==='/robots.txt'?'User-agent: *':'ok');
 }));
 const snapshot={pages:{'/':{status:200}},robots:{status:200,text:'User-agent: *'}} as any;
 vi.mocked(captureSeo).mockResolvedValueOnce(snapshot).mockResolvedValueOnce(snapshot).mockImplementationOnce(async options=>{expect(options.origin).toBe('http://proxy');throw new Error('public proxy failed');});
 await expect(protectedUpgrade(home,root,'blog',state.program.manifest.id,undefined)).rejects.toThrow(/public proxy failed/);
 expect(state.activated).toBe(false);expect(restoreCheckpoint).toHaveBeenCalledTimes(1);
 expect(json(join(root,'.weava-update.json')).status).toBe('rolled-back');expect(existsSync(join(home,'proxy/blog/active.json'))).toBe(false);
});
