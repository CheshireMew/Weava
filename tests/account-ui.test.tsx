// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import AccountPanel from '../apps/admin/src/AccountPanel.tsx';
import { LoginScreen } from '../apps/admin/src/LoginScreen.tsx';
import { ApiClientError } from '@weava/contracts/api-client';
import { useAdminSession } from '../apps/admin/src/useAdminSession.ts';
const mocks=vi.hoisted(()=>({api:vi.fn(),qr:vi.fn()}));
vi.mock('../apps/admin/src/api.ts',()=>({api:mocks.api}));
vi.mock('qrcode',()=>({default:{toDataURL:mocks.qr}}));
let root:Root,host:HTMLDivElement;
const account={username:'owner',displayName:'站主',adminPath:'/admin',twoFactorEnabled:false,recoveryCodesRemaining:0,events:[],sessions:[]};
const setError=vi.fn(),notify=vi.fn();
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  mocks.api.mockReset();mocks.qr.mockReset();setError.mockClear();notify.mockClear();
  mocks.qr.mockResolvedValue('data:image/png;base64,qr');
  mocks.api.mockImplementation(async(path:string)=>path==='account'?structuredClone(account):{});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.useRealTimers();});
async function renderAccount(){await act(async()=>root.render(<AccountPanel setError={setError} notify={notify} sessionGeneration={0}/>));}
function input(label:string){const found=[...host.querySelectorAll('label')].find(node=>node.textContent?.startsWith(label));expect(found,label).toBeDefined();return found!.control as HTMLInputElement;}
async function fill(label:string,value:string){await act(async()=>{const field=input(label);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));});}
function button(text:string){const found=[...host.querySelectorAll('button')].find(node=>node.textContent===text);expect(found,text).toBeDefined();return found!;}
async function click(text:string){await act(async()=>button(text).click());}
it('binds the authenticator QR and requires saving newly generated codes before returning to login',async()=>{
  const uri='otpauth://totp/Weava:owner?secret=DEMO&issuer=Weava';
  mocks.api.mockImplementation(async(path:string)=>path==='account'?structuredClone(account):path==='account/two-factor/begin'?{secret:'DEMO',uri}:path==='account/two-factor/confirm'?{recoveryCodes:['ONE','TWO']}:{});
  await renderAccount();expect(button('设置两步验证').disabled).toBe(true);
  await fill('当前密码','violet river lantern 2026!');await click('设置两步验证');
  expect(mocks.qr).toHaveBeenCalledWith(uri,expect.objectContaining({width:208}));expect(host.querySelector('img')?.alt).toContain('验证器');
  await fill('6 位验证码','123456');await click('确认启用');
  expect(mocks.api).toHaveBeenCalledWith('account/two-factor/confirm',{password:'violet river lantern 2026!',code:'123456'});
  expect(host.textContent).toContain('等待验证器显示下一组数字');expect(button('重新登录').disabled).toBe(true);
  await act(async()=>input('我已将恢复码保存在网站之外').click());expect(button('重新登录').disabled).toBe(false);
  const write=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:write}});
  await click('复制恢复码');expect(write).toHaveBeenCalledWith('ONE\nTWO');
  const make=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:isolated'),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});vi.useFakeTimers();await click('下载恢复码');expect(make).toHaveBeenCalled();await act(async()=>vi.advanceTimersByTime(1000));expect(revoke).toHaveBeenCalledWith('blob:isolated');
});
it('requires fresh proof when renewing recovery codes and choosing which sessions to revoke',async()=>{
  const enabled={...account,twoFactorEnabled:true,recoveryCodesRemaining:1};
  mocks.api.mockImplementation(async(path:string)=>path==='account'?structuredClone(enabled):{recoveryCodes:['NEW-CODE']});
  await renderAccount();expect(button('重新生成恢复码并退出全部登录').disabled).toBe(true);
  await fill('当前密码','violet river lantern 2026!');await fill('验证码或恢复码','OLD-CODE');await click('重新生成恢复码并退出全部登录');
  expect(mocks.api).toHaveBeenCalledWith('account/two-factor/recovery-codes',{password:'violet river lantern 2026!',code:'OLD-CODE'});expect(host.textContent).toContain('NEW-CODE');
});
it('keeps entered credentials out of storage and clears proof after a sensitive action',async()=>{
  const storage=vi.spyOn(Storage.prototype,'setItem');await renderAccount();await fill('当前密码','violet river lantern 2026!');await click('退出其他会话');
  for(const field of host.querySelectorAll<HTMLInputElement>('input[pattern]'))expect(()=>new RegExp(field.pattern,'v')).not.toThrow();
  expect(mocks.api).toHaveBeenCalledWith('account/sessions/revoke',{password:'violet river lantern 2026!',code:undefined,id:'others'});
  expect(input('当前密码').value).toBe('');expect(storage).not.toHaveBeenCalled();
});
it('shows the server wait and prevents immediate resubmission on the login screen',async()=>{
  vi.useFakeTimers();mocks.api.mockImplementation(async(path:string)=>{if(path==='session')return {authenticated:false,initialized:true,version:'test'};throw new ApiClientError('请稍后重试',429,{retryAt:Date.now()+2000},2);});
  function Screen(){const model=useAdminSession(setError);return <LoginScreen model={model} error="" setError={setError}/>;}
  await act(async()=>root.render(<Screen/>));await fill('站主密码','violet river lantern 2026!');await click('进入网站');
  expect(button('2 秒后重试').disabled).toBe(true);const attempts=mocks.api.mock.calls.filter(([path])=>path==='login').length;
  await click('2 秒后重试');expect(mocks.api.mock.calls.filter(([path])=>path==='login')).toHaveLength(attempts);
  await act(async()=>vi.advanceTimersByTime(2100));expect(button('进入网站').disabled).toBe(false);
});
