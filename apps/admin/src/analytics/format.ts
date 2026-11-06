export const number = (v: number) => v.toLocaleString('zh-CN');
export const channels: Record<string, string> = {
  'direct-or-unknown': '直接 / 未知',
  'search-referral': '搜索引擎',
  'ai-referral': 'AI 来源',
  social: '社交媒体',
  referral: '其它引荐',
  campaign: '推广链接',
  paid: '付费推广',
  email: '邮件',
};
export const devices: Record<string, string> = {
  desktop: '电脑',
  smartphone: '手机',
  tablet: '平板',
  other: '其它设备',
  unknown: '未知',
};
export const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
export const country = (code: string) => {
  try {
    return /^[A-Z]{2}$/.test(code) ? regionNames.of(code) || code : '未知';
  } catch {
    return '未知';
  }
};
export const duration = (ms: number | null) =>
  ms === null || ms < 1000
    ? '—'
    : ms < 60000
      ? Math.round(ms / 1000) + ' 秒'
      : Math.floor(ms / 60000) + ' 分 ' + Math.round((ms % 60000) / 1000) + ' 秒';
export const dateAt = (ts: string, timezone: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ts));
export function change(now: number, before: number) {
  return before
    ? `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}%`
    : now
      ? '新增'
      : '—';
}
export function shift(date: string, days: number) {
  return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
}
export function today(timeZone = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
