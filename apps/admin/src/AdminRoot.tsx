import { lazy, Suspense, useState } from 'react';
import { LoginScreen } from './LoginScreen.tsx';
import { useAdminSession } from './useAdminSession.ts';
import { AccountAccess,takeOwnerAccessToken } from './AccountAccess.tsx';
const AdminWorkspace=lazy(()=>import('./AdminWorkspace.tsx'));
export function AdminRoot(){
  const [error,setError]=useState(''),authentication=useAdminSession(setError);
  const [accessToken,setAccessToken]=useState(takeOwnerAccessToken),[notice,setNotice]=useState('');
  if(accessToken!==null)return <AccountAccess token={accessToken} onCancel={()=>setAccessToken(null)} onComplete={async username=>{
    authentication.setUsername(username);authentication.setPassword('');authentication.setCode('');
    authentication.setSession(current=>({authenticated:false,initialized:true,version:current?.version??'0.1.0',accountLinks:true}));
    setNotice('账户已设置，请使用新密码登录。');setError('');setAccessToken(null);
  }}/>;
  if(!authentication.session?.authenticated)return <LoginScreen model={authentication} error={error} setError={setError} notice={notice}/>;
  return <Suspense fallback={<main className="loading-screen"><p role="status">正在打开后台…</p></main>}><AdminWorkspace authentication={authentication} error={error} setError={setError}/></Suspense>;
}
