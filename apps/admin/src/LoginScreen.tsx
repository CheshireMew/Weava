import { api } from './api.ts';
import type { AdminSession } from './useAdminSession.ts';
export function LoginScreen({
  model,
  error,
  setError,
}: {
  model: AdminSession;
  error: string;
  setError: (message: string) => void;
}) {
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
          <p role="status">正在连接网站…</p>
        )}
      </main>
    );
  if (!session.authenticated)
    return (
      <main className="login">
        <div className="login-brand">w</div>
        <h1>回到你的空间。</h1>
        <p>
          {session.initialized
            ? '登录 Weava，继续创造。'
            : '请通过初始化命令或密码恢复命令设置站主密码。'}
        </p>
        <form
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
          <label>
            站主密码
            <input
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={!!error}
              aria-describedby={error ? 'login-error' : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>验证码或恢复码（如已开启）<input autoComplete="one-time-code" value={model.code} onChange={e=>model.setCode(e.target.value)}/></label>
          <button className="primary" disabled={!session.initialized || loginPending || !!model.cooldown.seconds}>
            {model.cooldown.seconds ? `${model.cooldown.seconds} 秒后重试` : loginPending ? '正在登录…' : '进入网站'}
          </button>
        </form>
        {error && (
          <p className="error" role="alert" id="login-error">
            {error}
          </p>
        )}
        <a href="/">查看网站 ↗</a>
      </main>
    );
  return null;
}
