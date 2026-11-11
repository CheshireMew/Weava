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
const aiDomains: Record<string, string> = {
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
const aiProviders = new Set(Object.values(aiDomains));
export function referral(referrer: string, origin = '', campaign: any = {}) {
  let host = '';
  if(referrer)try {
    host = new URL(
      referrer.includes('://') ? referrer : 'https://' + referrer,
    ).hostname.toLowerCase();
  } catch {}
  if(origin&&host)try {
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
  for (const [domain, label] of Object.entries(aiDomains))
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
        'search.yahoo.co.jp': 'Yahoo',
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

const engineAliases:Record<string,string>={google:'Google',bing:'Bing',baidu:'百度','百度':'百度',duckduckgo:'DuckDuckGo',yahoo:'Yahoo',yandex:'Yandex',sogou:'搜狗','搜狗':'搜狗','360':'360',chatgpt:'ChatGPT',perplexity:'Perplexity',claude:'Claude',gemini:'Gemini',copilot:'Copilot',grok:'Grok',deepseek:'DeepSeek','豆包':'豆包',kimi:'Kimi'};
export function canonicalEngine(value:string) {
  const name=value.trim();
  if (!name) return '';
  const alias=name.toLowerCase();
  return Object.hasOwn(engineAliases,alias)?engineAliases[alias]:referral(name).engine;
}
export function analyticsSourceEngine(engine: string, source: string) {
  const provider = canonicalEngine(meaningfulSourceLabel(source));
  const label = meaningfulSourceLabel(engine);
  return aiProviders.has(provider) ? provider : canonicalEngine(label) || label || provider;
}

export const unrecordedAnalyticsSource = '直接 / 未知';
const unknownSourceLabels = new Set(['direct', 'unknown', 'not set', 'none', 'direct-or-unknown', '直接 / 未知', '未记录来源', '直接', '未知']);
function meaningfulSourceLabel(value: string) {
  const label = value.trim();
  return unknownSourceLabels.has(label.toLowerCase().replace(/^\((.*)\)$/, '$1')) ? '' : label;
}

/** An attribution requires a named source, engine, or recorded external host. */
export function analyticsKnownSourceName(source: string, engine: string, referrer: string) {
  const label = meaningfulSourceLabel(source) || meaningfulSourceLabel(engine);
  if (label) return canonicalEngine(label) || label;
  const host = meaningfulSourceLabel(referrer);
  if (!host) return '';
  const origin = referral(host);
  return origin.engine || origin.host;
}
export function analyticsSourceName(source: string, engine: string, referrer: string) {
  return analyticsKnownSourceName(source, engine, referrer) || unrecordedAnalyticsSource;
}
export function analyticsSourceChannel(channel: string, name: string, referrer: string) {
  const generic = ['direct-or-unknown', 'search-referral', 'referral', 'campaign'].includes(channel);
  if (generic && aiProviders.has(name)) return 'ai-referral';
  if (channel !== 'direct-or-unknown' || !name) return channel;
  const external = referral(meaningfulSourceLabel(referrer));
  if (external.host) return external.channel;
  return canonicalEngine(name) ? 'search-referral' : 'campaign';
}
