import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { useAuthCooldown } from './useAuthCooldown.ts';
import { connectionFailure, retryConnection } from './connection-recovery.ts';
export function useAdminSession(setError: (message: string) => void) {
  const cooldown=useAuthCooldown();
  const [session, setSession] = useState<Awaited<ReturnType<typeof readSession>> | null>(null);
  const [password, setPassword] = useState(''),
    [loginPending, setLoginPending] = useState(false);
  const [username,setUsername]=useState('owner'),[code,setCode]=useState(''),[reauthCode,setReauthCode]=useState('');
  const [sessionGeneration,setSessionGeneration]=useState(0);
  const [reauth, setReauth] = useState(false),
    [reauthPassword, setReauthPassword] = useState(''),
    [reauthError, setReauthError] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false),
    reauthLater = useRef(false);
  function readSession() {
    return api('session');
  }
  useEffect(() => {
    let cancelled = false, attempt = 0, cancelRetry: (() => void) | undefined;
    const read = () => {
      void readSession().then(value => {
        if (!cancelled) {
          setSession(current => current ?? value);
          if (attempt) setError('');
        }
      }).catch(error => {
        if (cancelled) return;
        setError(error.message);
        if (connectionFailure(error)) cancelRetry = retryConnection(read, attempt++);
      });
    };
    read();
    return () => { cancelled = true; cancelRetry?.(); };
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    try { localStorage.setItem('weava-exclude', '1'); } catch {}
  }, [session?.authenticated]);
  useEffect(() => {
    const expire = () => {
      setSessionExpired(true);
      if (!reauthLater.current) setReauth(true);
    };
    window.addEventListener('weava-session-expired', expire);
    const ended=()=>{setSession(current=>current?{...current,authenticated:false}:current);setSessionExpired(false);setReauth(false);};
    window.addEventListener('weava-session-ended',ended);
    return () => {window.removeEventListener('weava-session-expired', expire);window.removeEventListener('weava-session-ended',ended);};
  }, []);
  return {
    cooldown,
    session,
    username,setUsername,code,setCode,reauthCode,setReauthCode,
    sessionGeneration,setSessionGeneration,
    setSession,
    password,
    setPassword,
    loginPending,
    setLoginPending,
    reauth,
    setReauth,
    reauthPassword,
    setReauthPassword,
    reauthError,
    setReauthError,
    sessionExpired,
    setSessionExpired,
    reauthLater,
  };
}
export type AdminSession = ReturnType<typeof useAdminSession>;
