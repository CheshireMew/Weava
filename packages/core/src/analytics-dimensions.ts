import { UAParser } from 'ua-parser-js';

export interface AnalyticsContext {
  ip?: string;
  origin?: string;
  language?: string;
}
export function deviceInfo(agent: string, hints: any = {}) {
  const parsed = new UAParser(agent.slice(0, 2000)).getResult();
  const browser = parsed.browser.name || '未知';
  let os = parsed.os.name || '未知';
  if (os === 'Mac OS') os = 'macOS';
  let device =
    parsed.device.type === 'mobile'
      ? 'smartphone'
      : parsed.device.type === 'tablet'
        ? 'tablet'
        : parsed.device.type
          ? 'other'
          : os !== '未知'
            ? 'desktop'
            : 'unknown';
  // iPadOS can present a desktop Safari UA. This is a browser hint, not a guessed model.
  if (/Macintosh/.test(agent) && Number(hints?.touchPoints) > 1) {
    os = 'iOS';
    device = 'tablet';
  }
  const model = parsed.device.model
    ? [parsed.device.vendor, parsed.device.model].filter(Boolean).join(' ')
    : '未知';
  return { browser, os, device, model };
}
const within = (host: string, domain: string) => host === domain || host.endsWith('.' + domain);
export function referral(referrer: string, origin = '', campaign: any = {}) {
  let host = '';
  try {
    host = new URL(
      referrer.includes('://') ? referrer : 'https://' + referrer,
    ).hostname.toLowerCase();
  } catch {}
  try {
    if (host === new URL(origin).hostname.toLowerCase()) host = '';
  } catch {}
  const source = String(campaign?.source || '')
    .trim()
    .slice(0, 100);
  const medium = String(campaign?.medium || '')
    .trim()
    .toLowerCase()
    .slice(0, 100);
  const name = String(campaign?.campaign || '')
    .trim()
    .slice(0, 200);
  let channel = 'direct-or-unknown',
    engine = '';
  const ai: Record<string, string> = {
    'chatgpt.com': 'ChatGPT',
    'chat.openai.com': 'ChatGPT',
    'perplexity.ai': 'Perplexity',
    'claude.ai': 'Claude',
    'gemini.google.com': 'Gemini',
    'copilot.microsoft.com': 'Copilot',
    'grok.com': 'Grok',
    'deepseek.com': 'DeepSeek',
    'doubao.com': '豆包',
    'kimi.com': 'Kimi',
    'kimi.moonshot.cn': 'Kimi',
  };
  for (const [domain, label] of Object.entries(ai))
    if (within(host, domain)) {
      channel = 'ai-referral';
      engine = label;
      break;
    }
  if (!engine) {
    if (/(^|\.)google\.(?:com|[a-z]{2,3}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(host))
      engine = 'Google';
    else
      for (const [domain, label] of Object.entries({
        'bing.com': 'Bing',
        'baidu.com': '百度',
        'duckduckgo.com': 'DuckDuckGo',
        'search.yahoo.com': 'Yahoo',
        'yandex.com': 'Yandex',
        'yandex.ru': 'Yandex',
        'sogou.com': '搜狗',
        'so.com': '360',
      }))
        if (within(host, domain)) {
          engine = label;
          break;
        }
    if (engine) channel = 'search-referral';
  }
  if (!engine && host)
    channel = [
      't.co',
      'twitter.com',
      'x.com',
      'facebook.com',
      'instagram.com',
      'linkedin.com',
      'weibo.com',
      'zhihu.com',
      'xiaohongshu.com',
      'bsky.app',
      'reddit.com',
      'youtube.com',
    ].some((domain) => within(host, domain))
      ? 'social'
      : 'referral';
  if (['cpc', 'ppc', 'paid', 'paidsearch', 'paid-social', 'display'].includes(medium))
    channel = 'paid';
  else if (medium === 'email') channel = 'email';
  else if (medium === 'social') channel = 'social';
  else if (source && !host) channel = 'campaign';
  return { host, channel, engine, source, medium, campaign: name };
}
