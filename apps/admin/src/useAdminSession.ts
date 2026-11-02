import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { useAuthCooldown } from './useAuthCooldown.ts';
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
    readSession()
      .then(setSession)
      .catch((error) => setError(error.message));
  }, []);
  useEffect(() => {
    const expire = () => {
      setSessionExpired(true);
      if (!reauthLater.current) setReauth(true);
    };
    window.addEventListener('weava-session-expired', expire);
    return () => window.removeEventListener('weava-session-expired', expire);
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
