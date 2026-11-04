import { useEffect, useState } from 'react';
import type { z } from 'zod';
import type { accountAccessResult } from '@weava/contracts/session-api';
import { api } from './api.ts';
import { useAuthCooldown } from './useAuthCooldown.ts';
import { PasswordField } from './PasswordField.tsx';

export function takeOwnerAccessToken() {
  const fragment=new URLSearchParams(window.location.hash.slice(1)),token=fragment.get('owner-access');
  if(token===null)return null;
  fragment.delete('owner-access');
  window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search+(fragment.size?'#'+fragment:''));
  return token;
}
export function AccountAccess({token,onComplete,onCancel}:{token:string;onComplete:(username:string)=>Promise<void>;onCancel:()=>void}) {
  const [grant,setGrant]=useState<z.infer<typeof accountAccessResult>|null>(null),[error,setError]=useState('');
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[repeat,setRepeat]=useState(''),[busy,setBusy]=useState(false);
  const cooldown=useAuthCooldown();
  useEffect(()=>{
    let active=true;
    api('account-access',{token}).then(value=>{if(active){setGrant(value);setUsername(value.username);}})
      .catch(()=>{if(active)setError('链接无效、已过期或已使用。请回到启动窗口，在本机重新生成设置链接。');});
    return()=>{active=false;};
  },[token]);
  return <main className="login account-access"><div className="login-brand">w</div>
    <h1>{grant?.mode==='reset'?'重新设置账户':'设置你的站主账户'}</h1>
    {grant?<>
      <p>{grant.mode==='initialize'?'创建自己的账户名和密码，开始使用 Weava。':'设置新的账户名和密码。提交成功后，所有旧网页登录都会退出。'}</p>
      <p>链接有效至 {new Date(grant.expiresAt).toLocaleTimeString()}，只能完成一次设置。</p>
      {grant.twoFactorEnabled&&<p>{grant.resetTwoFactor?'本次已由本机授权关闭两步验证。':'已有两步验证会保留，之后登录仍需验证码或恢复码。'}</p>}
      <form aria-busy={busy} onSubmit={async event=>{
        event.preventDefault();if(busy||cooldown.seconds)return;setError('');
        if(password!==repeat){setError('两次输入的密码不一致。');return;}
        setBusy(true);
        try{
          const result=await api('account-access/complete',{token,username,password,confirmPassword:repeat});
          setPassword('');setRepeat('');await onComplete(result.username);
        }catch(error:any){cooldown.record(error);setError(error.message);}
        finally{setBusy(false);}
      }}>
        <label>账户名<input required minLength={3} maxLength={64} pattern={'[a-zA-Z0-9_.\\-]+'} autoComplete="username" value={username} onChange={event=>setUsername(event.target.value)}/></label>
        <PasswordField label="新密码" required minLength={15} maxLength={1024} autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)}/>
        <PasswordField label="确认新密码" required maxLength={1024} autoComplete="new-password" value={repeat} onChange={event=>setRepeat(event.target.value)}/>
        <p>至少 15 个字符，支持中文和空格。可以使用多个不相关词组成的长口令，并交给浏览器保存。</p>
        <button className="primary" disabled={busy||!!cooldown.seconds}>{cooldown.seconds?`${cooldown.seconds} 秒后重试`:busy?'正在设置…':'保存账户并前往登录'}</button>
      </form>
    </>:!error&&<p role="status">正在检查设置链接…</p>}
    {error&&<p role="alert" className="error">{error}</p>}
    <button type="button" disabled={busy} onClick={onCancel}>返回登录</button>
  </main>;
}
