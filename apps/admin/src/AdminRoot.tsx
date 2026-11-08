import { Suspense, useState } from 'react';
import {retryableLazy as lazy} from './ErrorBoundary.tsx';
import { LoginScreen } from './LoginScreen.tsx';
import { useAdminSession } from './useAdminSession.ts';
import { AccountAccess,takeOwnerAccessToken } from './AccountAccess.tsx';
import {ErrorBoundary} from './ErrorBoundary.tsx';
import {LoadingState} from './LoadingState.tsx';
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
  return <ErrorBoundary><Suspense fallback={<main className="loading-screen"><LoadingState label="打开后台" /></main>}><AdminWorkspace authentication={authentication} error={error} setError={setError}/></Suspense></ErrorBoundary>;
}
