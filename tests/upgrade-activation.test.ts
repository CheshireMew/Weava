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

const state=vi.hoisted(()=>({program:null as any,site:null as any,root:'',failure:'',activated:false,recovering:false}));
vi.mock('../packages/manager/src/state.ts',async original=>({...await original<any>(),programFor:()=>state.program}));
vi.mock('../packages/manager/src/operations.ts',()=>({
  onlineWorkspace:async()=>{const root=join(state.root,'work');mkdirSync(root);return {root,stamp:'stable'};},checkWorkspace:async()=>({}),
  adoptSite:async(_home:string,root:string,_id:string,_program:string,_build:string,options:any)=>{const point=join(root,'checkpoint');atomic(join(root,'.weava-update.json'),{status:'switched',point,programId:'old',online:{operation:options.operation}});return {point};},
  restoreCheckpoint:vi.fn(()=>{const row=state.site.settings();state.site.saveSettings({...row.value,name:'Restored old data'},row.revision);}),
  withLease:async(_home:any,_root:any,_program:any,action:()=>unknown)=>action(),
}));
vi.mock('../packages/manager/src/public-inventory.ts',()=>({siteStamp:()=> 'stable',publicInventory:()=>({paths:['/'],domain:'https://fixture.example',redirects:[],dynamicRedirects:[]})}));
vi.mock('../packages/manager/src/seo-check.ts',()=>({upgradeProbePath:()=>'/probe',captureSeo:async()=>({pages:{'/':{status:200}},robots:{status:200,text:'User-agent: *'}}),compareSeo:()=>({passed:true,differences:[]})}));
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
  vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
    const url=new URL(input);
    if(url.hostname==='proxy'){
      if(url.pathname==='/robots.txt')return new Response('User-agent: *');
      if(state.recovering)return new Response('ok');
      return new Response('maintenance',{status:state.activated?502:503,headers:{'Retry-After':'60','Cache-Control':'no-store'}});
    }
    return new Response('ok');
  }));
  await expect(protectedUpgrade(home,root,'blog',state.program.manifest.id,undefined)).rejects.toThrow(/当前数据已保留/);
  expect(state.site.settings().value.name).toBe('Saved after activation');expect(restoreCheckpoint).not.toHaveBeenCalled();
  expect(json(join(root,'.weava-update.json'))).toMatchObject({status:'activation-failed',writesEnabled:true});expect(existsSync(join(home,'proxy/blog/active.json'))).toBe(true);
  expect(vi.mocked(requestHost).mock.calls.filter(call=>call[1]==='stop')).toHaveLength(1);
  state.recovering=true;expect(await recoverProtected(home,root)).toMatchObject({recovered:true,dataPreserved:true});
  expect(state.site.settings().value.name).toBe('Saved after activation');expect(restoreCheckpoint).not.toHaveBeenCalled();expect(existsSync(join(home,'proxy/blog/active.json'))).toBe(false);
  await expect(recoverProtected(home,root)).rejects.toThrow(/restore-data/);
  expect(await recoverProtected(home,root,true)).toMatchObject({recovered:true});expect(state.site.settings().value.name).toBe('Restored old data');expect(restoreCheckpoint).toHaveBeenCalledTimes(1);
  expect(await recoverProtected(home,root)).toEqual({recovered:false,point:null});expect(state.site.settings().value.name).toBe('Restored old data');
});
