import { WeavaError } from '@weava/contracts';
export function validateAdminPath(path: string) {
  if (!/^\/[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/.test(path) ||
    /^\/(api|media|_admin|_astro|__health|robots|sitemap|feed|search)$/i.test(path))
    throw new WeavaError('后台地址需要是 / 开头的 3～80 个字母、数字、_ 或 -，不能使用系统地址。');
  return path;
}
export function isAdminPage(path: string, configured: string) {
  return path === configured || path === configured + '/';
}
