// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { AccountAccess,takeOwnerAccessToken } from '../apps/admin/src/AccountAccess.tsx';
import { AdminRoot } from '../apps/admin/src/AdminRoot.tsx';
const mocks=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('../apps/admin/src/api.ts',()=>({api:mocks.api}));
let root:Root,host:HTMLDivElement;
const token='a'.repeat(64),complete=vi.fn(async()=>{}),cancel=vi.fn();
const grant={mode:'initialize',expiresAt:new Date(Date.now()+600000).toISOString(),username:'owner',twoFactorEnabled:false,resetTwoFactor:false};
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  mocks.api.mockReset();complete.mockClear();cancel.mockClear();
  window.history.replaceState(null,'','/admin/');
  mocks.api.mockImplementation(async(path:string)=>path==='account-access'?grant:path==='session'?{authenticated:false,initialized:false,version:'test',accountLinks:true}:{ok:true,username:'nico',adminPath:'/admin'});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
async function render(){await act(async()=>root.render(<AccountAccess token={token} onComplete={complete} onCancel={cancel}/>));}
async function fill(label:string,value:string){await act(async()=>{const parent=[...host.querySelectorAll('label')].find(item=>item.textContent===label)!;const input=parent.control as HTMLInputElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
async function submit(){await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
it('takes the secret out of the address immediately, preserves unrelated state, and never persists it in browser storage',()=>{
  const storage=vi.spyOn(Storage.prototype,'setItem');window.history.replaceState({test:1},'','/admin/?panel=account#owner-access='+token+'&other=1');
  expect(takeOwnerAccessToken()).toBe(token);expect(window.location.href).not.toContain(token);expect(window.location.hash).toBe('#other=1');expect(window.history.state).toEqual({test:1});expect(storage).not.toHaveBeenCalled();
});
it('collects the chosen account, validates password confirmation, and proceeds to ordinary login',async()=>{
  const storage=vi.spyOn(Storage.prototype,'setItem');await render();await fill('账户名','nico');await fill('新密码','violet river lantern phrase!');await fill('确认新密码','different');
  await submit();expect(host.textContent).toContain('两次输入的密码不一致');expect(mocks.api).not.toHaveBeenCalledWith('account-access/complete',expect.anything());
  await fill('确认新密码','violet river lantern phrase!');await submit();
  expect(mocks.api).toHaveBeenCalledWith('account-access/complete',{token,username:'nico',password:'violet river lantern phrase!',confirmPassword:'violet river lantern phrase!'});
  expect(complete).toHaveBeenCalledWith('nico');expect(mocks.api).not.toHaveBeenCalledWith('login',expect.anything());expect(storage).not.toHaveBeenCalled();
});
it('offers regeneration guidance for an invalid link without displaying the credential form',async()=>{
  mocks.api.mockRejectedValue(new Error('expired'));await render();expect(host.textContent).toContain('重新生成设置链接');expect(host.querySelector('form')).toBeNull();
});
it('shows explicitly whether existing two-factor protection will be retained',async()=>{
  mocks.api.mockResolvedValue({...grant,mode:'reset',twoFactorEnabled:true});await render();expect(host.textContent).toContain('已有两步验证会保留');expect(host.textContent).toContain('重新设置账户');
});
it('an anonymous visitor sees guidance, while the local-link holder can set up without loading the editor',async()=>{
  await act(async()=>root.render(<AdminRoot/>));expect(host.textContent).toContain('启动窗口');expect(host.querySelector('input[type="password"]')).toBeNull();
  await act(async()=>root.unmount());root=createRoot(host);window.history.replaceState(null,'','/admin/#owner-access='+token);
  await act(async()=>root.render(<AdminRoot/>));expect(host.textContent).toContain('设置你的站主账户');expect(window.location.href).not.toContain(token);
  mocks.api.mockImplementation(async(path:string)=>path==='session'?{authenticated:false,initialized:true,version:'test'}:{ok:true,username:'nico',adminPath:'/admin'});
  await fill('账户名','nico');await fill('新密码','violet river lantern phrase!');await fill('确认新密码','violet river lantern phrase!');await submit();
  expect(host.textContent).toContain('账户已设置，请使用新密码登录');expect(host.textContent).toContain('进入网站');expect(host.querySelector<HTMLInputElement>('input[autocomplete="username"]')?.value).toBe('nico');
});
