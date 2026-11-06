import { referral } from './analytics-dimensions.ts';
export const visitorId = (e: any) => e.visitor || 'legacy-' + e.id;
export function decorate(row: any) {
  const fallback = referral(row.referrer || '');
  return {
    ...row,
    country: row.country || '',
    browser: row.browser || '未知',
    os: row.os || '未知',
    device: row.device || 'unknown',
    model: row.model || '未知',
    channel: row.channel || fallback.channel,
    engine: row.engine || fallback.engine,
    source: row.source || '',
    medium: row.medium || '',
    campaign: row.campaign || '',
  };
}
