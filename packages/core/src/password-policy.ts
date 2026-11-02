import { WeavaError } from '@weava/contracts';

// Local blocklist: passwords never leave this process for a strength check.
const common = new Set(['password', 'password123', 'password1234', 'password12345',
  '123456', '123456789', '123456789012345', 'qwerty', 'qwerty1234567890',
  'admin', 'admin123', 'admin1234567890', 'letmein', 'welcome', 'iloveyou',
  'correct horse battery staple', 'replace-with-a-strong-password']);
export function validateOwnerName(username: string) {
  if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username))
    throw new WeavaError('账户名需要 3～64 个字母、数字或 ._-。');
}
export function validateOwnerPassword(password: string, username: string) {
  if ([...password].length < 15 || password.length > 1024)
    throw new WeavaError('新密码需要至少 15 个字符，最多 1024 个字符。');
  const value = password.trim().toLowerCase();
  const withoutSuffix = value.replace(/[\d!@#$%^&*_.-]+$/g, '').trimEnd();
  if (common.has(value) || common.has(withoutSuffix) || value === username.toLowerCase() || withoutSuffix === username.toLowerCase() ||
    /^(.)\1+$/u.test(value) || /^(\d+)$/u.test(value) ||
    /^(.{1,32})\1+$/u.test(value) ||
    'abcdefghijklmnopqrstuvwxyz'.includes(value) || 'qwertyuiopasdfghjklzxcvbnm'.includes(value))
    throw new WeavaError('密码容易被猜到，请使用独特的长密码或多个不相关词语。');
}
