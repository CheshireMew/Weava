import { useEffect, useState, useRef, useId } from 'react';
import QRCode from 'qrcode';
import { api } from './api.ts';
import type { ApiOutput } from '@weava/contracts/api';
import { useAuthCooldown } from './useAuthCooldown.ts';
import { PasswordField } from './PasswordField.tsx';
const eventNames:Record<string,string>={
  'account-initialized':'初始化账户','password-reset':'重置密码','account-recovered':'本机恢复账户',
  'account-updated':'修改账户资料或密码','login-succeeded':'登录成功','login-failed':'身份验证失败',
  logout:'退出登录','sessions-revoked':'撤销登录会话','two-factor-enabled':'启用两步验证',
  'two-factor-disabled':'关闭两步验证','two-factor-reset':'本机重置两步验证',
  'recovery-code-used':'使用恢复码','recovery-codes-renewed':'重新生成恢复码',
  'cli-token-rotated':'轮换 CLI 令牌','admin-path-changed':'更改后台入口',
};
const time=(value:string|null)=>value?new Date(value).toLocaleString():'暂无记录';
const sections=[['profile','账户资料'],['two-factor','两步验证'],['sessions','登录会话'],['events','账户记录']] as const;
export default function AccountPanel({setError,notify,sessionGeneration}:{setError:(message:string)=>void;notify:(message:string)=>void;sessionGeneration:number}) {
  const id=useId(),[section,setSection]=useState<(typeof sections)[number][0]>('profile');
  const [account,setAccount]=useState<ApiOutput<'account'>|null>(null);
  const [loadError,setLoadError]=useState('');
  const [username,setUsername]=useState(''),[displayName,setDisplayName]=useState(''),[adminPath,setAdminPath]=useState('');
  const [password,setPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[repeat,setRepeat]=useState(''),[code,setCode]=useState('');
  const [setup,setSetup]=useState<ApiOutput<'beginTwoFactor'>|null>(null),[qr,setQr]=useState('');
  const [codes,setCodes]=useState<string[]>([]),[savedCodes,setSavedCodes]=useState(false),[busy,setBusy]=useState(false);
  const [revokeAll,setRevokeAll]=useState(true),cooldown=useAuthCooldown(),loaded=useRef(false);
  function receiveAccount(value:ApiOutput<'account'>){setAccount(value);setLoadError('');if(!loaded.current){setUsername(value.username);setDisplayName(value.displayName);setAdminPath(value.adminPath);loaded.current=true;}}
  async function refresh(){const value=await api('account');receiveAccount(value);return value;}
  useEffect(()=>{
    let active=true;
    setLoadError('');
    api('account').then(value=>{if(active)receiveAccount(value);}).catch(error=>{if(active){setLoadError(error.message);setError(error.message);}});
    return()=>{active=false;};
  },[sessionGeneration]);
  useEffect(()=>{
    let active=true;setQr('');
    if(setup)QRCode.toDataURL(setup.uri,{width:208,margin:2,errorCorrectionLevel:'M'}).then(value=>{if(active)setQr(value);}).catch(()=>{if(active)setError('二维码生成失败，可以手动输入验证器密钥。');});
    return()=>{active=false;};
  },[setup]);
  async function act(action:()=>Promise<void>,keepPassword=false){
    if(busy||cooldown.seconds)return;setBusy(true);setError('');
    try{await action();if(!keepPassword)setPassword('');setCode('');}
    catch(error:any){cooldown.record(error);setError(error.message);}
    finally{setBusy(false);}
  }
  async function copyCodes(){try{await navigator.clipboard.writeText(codes.join('\n'));notify('恢复码已复制，请保存在网站之外。');}catch{setError('无法访问剪贴板，请下载或手动复制恢复码。');}}
  function downloadCodes(){
    const blob=new Blob(['Weava 恢复码\n每个只能使用一次，请保存在网站之外。\n\n'+codes.join('\n')+'\n'],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='weava-recovery-codes.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  if(codes.length)return <section className="panel account-panel"><h1>保存恢复码</h1>
    <p>每个恢复码只能使用一次。旧恢复码已经失效，请将这组新恢复码保存在网站之外。</p>
    <pre className="recovery-codes">{codes.join('\n')}</pre>
    <div className="account-actions"><button onClick={copyCodes}>复制恢复码</button><button onClick={downloadCodes}>下载恢复码</button></div>
    <p>网页登录已全部撤销。刚才使用过的验证器验证码不能重复使用，重新登录时请等待验证器显示下一组数字，或使用一个恢复码。</p>
    <label><input type="checkbox" checked={savedCodes} onChange={event=>setSavedCodes(event.target.checked)}/>我已将恢复码保存在网站之外</label>
    <button className="primary" disabled={!savedCodes} onClick={()=>window.location.reload()}>重新登录</button>
  </section>;
  if(!account)return <section className="panel"><div className="panel-title"><h1>账户</h1></div>{loadError?<div className="panel-state" role="alert"><p>账户未能载入。</p><button onClick={()=>refresh().catch(error=>{setLoadError(error.message);setError(error.message);})}>重新读取账户</button></div>:<p role="status">正在读取账户…</p>}</section>;
  const proof={password,code:code||undefined},blocked=busy||!!cooldown.seconds;
  const cannotProve=blocked||!password||(account.twoFactorEnabled&&!code);
  const verification=<div className="account-proof">
      <PasswordField label="当前密码" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)}/>
      {account.twoFactorEnabled&&<label>验证码或恢复码<input autoComplete="one-time-code" value={code} onChange={event=>setCode(event.target.value)}/></label>}
      {!!cooldown.seconds&&<p role="status">请在 {cooldown.seconds} 秒后重试。</p>}
    </div>;
  return <div className="panel account-panel" aria-busy={busy}><div className="panel-title"><h1>账户</h1></div>
    <div className="account-section-navigation"><nav className="library-status-tabs account-tabs" role="tablist" aria-label="账户分区">{sections.map(([key,label],index)=><button key={key} role="tab" id={id+key} aria-selected={section===key} aria-controls={id+'panel'} tabIndex={section===key?0:-1} onClick={()=>setSection(key)} onKeyDown={event=>{
      const next=event.key==='ArrowRight'?(index+1)%sections.length:event.key==='ArrowLeft'?(index+sections.length-1)%sections.length:event.key==='Home'?0:event.key==='End'?sections.length-1:-1;
      if(next>=0){event.preventDefault();setSection(sections[next][0]);document.getElementById(id+sections[next][0])?.focus();}
    }}>{label}</button>)}</nav></div>
    <section className="panel-section" role="tabpanel" id={id+'panel'} aria-labelledby={id+section}>
    {section==='profile'&&<section className="form-card"><h2>账户资料</h2><form onSubmit={event=>{event.preventDefault();act(async()=>{
      if(newPassword!==repeat)throw new Error('两次新密码不一致。');
      const result=await api('account',{...proof,username,displayName,newPassword:newPassword||undefined});
      if(result.loginRequired){window.location.reload();return;}await refresh();notify('账户资料已保存。');
    });}}>
      <label>账户名<input required minLength={3} maxLength={64} pattern={'[a-zA-Z0-9_.\\-]+'} autoComplete="username" value={username} onChange={event=>setUsername(event.target.value)}/></label>
      <label>显示名<input required maxLength={80} value={displayName} onChange={event=>setDisplayName(event.target.value)}/></label>
      <PasswordField label="新密码" minLength={15} maxLength={1024} autoComplete="new-password" value={newPassword} onChange={event=>setNewPassword(event.target.value)}/>
      <PasswordField label="确认新密码" autoComplete="new-password" value={repeat} onChange={event=>setRepeat(event.target.value)}/>
      <p>新密码至少 15 个字符，支持中文和空格。留空则保留原密码。修改账户名或密码会退出全部网页登录。</p>
      {verification}
      <button className="primary" disabled={cannotProve}>保存账户</button>
    </form></section>}
    {section==='two-factor'&&<section className="form-card"><h2>两步验证</h2>
      <p>{account.twoFactorEnabled?`已启用，还剩 ${account.recoveryCodesRemaining} 个恢复码。`:'使用验证器应用生成的 6 位验证码保护账户。'}</p>
      {account.twoFactorEnabled&&account.recoveryCodesRemaining<=2&&<p>恢复码即将用完，请重新生成并保存新的一组。</p>}
      {verification}
      {account.twoFactorEnabled?<div className="account-actions">
        <button disabled={cannotProve} onClick={()=>act(async()=>{const result=await api('account/two-factor/recovery-codes',{password,code});setCodes(result.recoveryCodes);})}>重新生成恢复码并退出全部登录</button>
        <button disabled={cannotProve} onClick={()=>act(async()=>{await api('account/two-factor/disable',{password,code});window.location.reload();})}>关闭两步验证</button>
      </div>:setup?<form onSubmit={event=>{event.preventDefault();act(async()=>{const result=await api('account/two-factor/confirm',{password,code});setSetup(null);setCodes(result.recoveryCodes);});}}>
        {qr&&<img className="account-qr" src={qr} width={208} height={208} alt="用验证器扫描此二维码"/>}
        <label>验证器密钥<input readOnly value={setup.secret}/></label><p>用验证器扫码或手动添加密钥，也可以<a href={setup.uri}>在本机验证器中打开</a>。设置在 10 分钟后过期。</p>
        <label>6 位验证码<input required pattern="[0-9]{6}" autoComplete="one-time-code" inputMode="numeric" value={code} onChange={event=>setCode(event.target.value)}/></label>
        <button disabled={blocked||!password}>确认启用</button><button type="button" disabled={blocked} onClick={()=>{setSetup(null);setPassword('');setCode('');}}>取消</button>
      </form>:<button disabled={cannotProve} onClick={()=>act(async()=>{setSetup(await api('account/two-factor/begin',proof));},true)}>设置两步验证</button>}
    </section>}
    {section==='sessions'&&<section className="form-card"><h2>登录会话</h2>{verification}<button disabled={cannotProve} onClick={()=>act(async()=>{await api('account/sessions/revoke',{...proof,id:'others'});await refresh();notify('其他登录会话已撤销。');})}>退出其他会话</button>
      {account.sessions.map(session=><div className="account-session" key={session.id}><strong>{session.current?'当前会话':'登录会话'} · {session.browser} / {session.os}</strong><p>登录：{time(session.createdAt)}<br/>最近活动：{time(session.lastSeen)}<br/>到期：{time(session.expiresAt)}</p>{!session.current&&<button disabled={cannotProve} onClick={()=>act(async()=>{await api('account/sessions/revoke',{...proof,id:session.id});await refresh();})}>撤销此会话</button>}</div>)}
    </section>}
    {section==='events'&&<section className="form-card"><h2>账户记录</h2><button disabled={busy} onClick={()=>act(async()=>{await refresh();})}>刷新记录</button>
      {account.events.length?<ol className="account-events">{account.events.map(event=><li key={event.id}><strong>{eventNames[event.event]??'账户操作'}</strong><span>{time(event.createdAt)} · {event.source==='cli'?'本机终端':'网页'}</span></li>)}</ol>:<p>暂无记录。</p>}
    </section>}
  </section></div>;
}
