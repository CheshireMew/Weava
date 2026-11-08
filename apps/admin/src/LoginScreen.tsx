import { useState } from 'react';
import { Dialog } from './Dialog.tsx';
import { api } from './api.ts';
import type { AdminSession } from './useAdminSession.ts';
import { PasswordField } from './PasswordField.tsx';
import { ArrowUpRight } from 'lucide-react';
import { LoadingState } from './LoadingState.tsx';
export function LoginScreen({
  model,
  error,
  setError,
  notice,
}: {
  model: AdminSession;
  error: string;
  setError: (message: string) => void;
  notice?:string;
}) {
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const { session, setSession, password, setPassword, loginPending, setLoginPending } = model;
  if (!session)
    return (
      <main className="loading-screen">
        <h1>Weava</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              onClick={() => {
                setError('');
                api('session')
                  .then(setSession)
                  .catch((error) => setError(error.message));
              }}
            >
              重新连接
            </button>
          </>
        ) : (
          <LoadingState label="连接网站" />
        )}
      </main>
    );
  if (!session.authenticated)
    return (
      <main className="login">
        <div className="login-brand">Weava</div>
        <h1>回到你的空间。</h1>
        <p>
          {session.initialized
            ? '登录 Weava，继续创造。'
            : '请从启动窗口打开一次性设置链接，创建你的账户。链接过期或丢失时，在本机运行 owner setup-link 重新生成。'}
        </p>
        {notice&&<p role="status">{notice}</p>}
        {session.initialized&&<form
          onSubmit={async (e) => {
            e.preventDefault();
            if (loginPending || model.cooldown.seconds) return;
            setLoginPending(true);
            setError('');
            try {
              await api('login', { password,username:model.username,code:model.code||undefined });
              setSession(await api('session'));
              setPassword('');model.setCode('');
              setError('');
            } catch (e: any) {
              model.cooldown.record(e);
              setError(e.message);
            } finally {
              setLoginPending(false);
            }
          }}
          aria-busy={loginPending}
        >
          <label>账户名<input autoComplete="username" required value={model.username} onChange={e=>model.setUsername(e.target.value)}/></label>
            <PasswordField
              label="站主密码"
              autoComplete="current-password"
              required
              aria-invalid={!!error}
              aria-describedby={error ? 'login-error' : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          <label>验证码或恢复码（如已开启）<input autoComplete="one-time-code" value={model.code} onChange={e=>model.setCode(e.target.value)}/></label>
          <button className="primary" disabled={!session.initialized || loginPending || !!model.cooldown.seconds}>
            {model.cooldown.seconds ? `${model.cooldown.seconds} 秒后重试` : loginPending ? '正在登录…' : '进入网站'}
          </button>
        </form>}
        {session.initialized && <button type="button" className="text-button" onClick={() => setRecoveryOpen(true)}>忘记密码？</button>}
        {recoveryOpen && <Dialog label="重设密码" onClose={() => setRecoveryOpen(false)}><div className="modal-title"><h2>重设密码</h2><button onClick={() => setRecoveryOpen(false)}>关闭</button></div><p>请在运行 Weava 的电脑或服务器终端，针对这个站点运行 <code>owner reset-link</code>，取得一次性重设链接后在网页里设置新密码。网页不会向未登录访客发放链接。</p></Dialog>}
        {error && (
          <p className="error" role="alert" id="login-error">
            {error}
          </p>
        )}
        <a href="/">查看网站 <ArrowUpRight size={14} aria-hidden="true" /></a>
      </main>
    );
  return null;
}
