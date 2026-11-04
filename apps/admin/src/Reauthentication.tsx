import { api } from './api.ts';
import { Dialog } from './Dialog.tsx';
import type { AdminSession } from './useAdminSession.ts';
import { PasswordField } from './PasswordField.tsx';
export function Reauthentication({
  model,
  setError,
  dirty,
  onAuthenticated,
}: {
  model: AdminSession;
  setError: (message: string) => void;
  dirty: boolean;
  onAuthenticated: () => Promise<void>;
}) {
  const {
    reauth,
    setReauth,
    reauthPassword,
    setReauthPassword,
    reauthError,
    setReauthError,
    sessionExpired,
    setSessionExpired,
    reauthLater,
    loginPending,
    setLoginPending,
  } = model;
  return (
    <>
      {' '}
      {sessionExpired && !reauth && (
        <div className="recovery-banner" role="status">
          登录已过期，编辑内容仍保留。
          <button type="button" onClick={() => setReauth(true)}>
            重新登录
          </button>
        </div>
      )}
      {reauth && (
        <Dialog
          label="重新登录"
          onClose={() => {
            reauthLater.current = true;
            setReauth(false);
          }}
          dismissible={!loginPending}
        >
          <h2>登录已过期</h2>
          <p>编辑内容仍保留在当前页面。</p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (loginPending || model.cooldown.seconds) return;
              setLoginPending(true);
              setReauthError('');
              try {
                await api('login', { password: reauthPassword,code:model.reauthCode||undefined });
                setReauth(false);
                setSessionExpired(false);
                reauthLater.current = false;
                setReauthPassword('');
                model.setReauthCode('');
                model.setSessionGeneration(value=>value+1);
                setError('');
                await onAuthenticated();
              } catch (error: any) {
                model.cooldown.record(error);
                setReauthError(error.message);
              } finally {
                setLoginPending(false);
              }
            }}
          >
              <PasswordField
                label="站主密码"
                data-autofocus
                autoComplete="current-password"
                required
                value={reauthPassword}
                onChange={(event) => setReauthPassword(event.target.value)}
              />
            <label>验证码或恢复码（如已开启）<input autoComplete="one-time-code" value={model.reauthCode} onChange={e=>model.setReauthCode(e.target.value)}/></label>
            {reauthError && (
              <p role="alert" className="error">
                {reauthError}
              </p>
            )}
            <button type="submit" disabled={loginPending || !!model.cooldown.seconds}>
              {model.cooldown.seconds ? `${model.cooldown.seconds} 秒后重试` : dirty ? '登录并保存草稿' : '重新登录'}
            </button>
            <button
              type="button"
              disabled={loginPending}
              onClick={() => {
                reauthLater.current = true;
                setReauth(false);
              }}
            >
              稍后登录
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
