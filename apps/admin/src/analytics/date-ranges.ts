import { shift, today } from './format.ts';
export const rangeChoices = [
  ['today', '今天'], ['yesterday', '昨天'], ['week', '本周'], ['last-week', '上周'],
  ['month', '本月'], ['last-month', '上月'], ['7', '近 7 天'], ['30', '近 30 天'], ['90', '近 90 天'],
] as const;
export function dateRange(key: string, timezone: string, date = today(timezone)) {
  const day = new Date(date + 'T00:00:00Z'), weekday = (day.getUTCDay() + 6) % 7;
  const month = date.slice(0, 7) + '-01';
  if (key === 'today') return { start: date, end: date };
  if (key === 'yesterday') return { start: shift(date, -1), end: shift(date, -1) };
  if (key === 'week') return { start: shift(date, -weekday), end: date };
  if (key === 'last-week') return { start: shift(date, -weekday - 7), end: shift(date, -weekday - 1) };
  if (key === 'month') return { start: month, end: date };
  if (key === 'last-month') { const end = shift(month, -1); return { start: end.slice(0, 7) + '-01', end }; }
  if (!['7', '30', '90'].includes(key)) throw new Error('日期范围不存在。');
  return { start: shift(date, 1 - Number(key)), end: date };
}
export function rangeLabel(start: string, end: string, timezone: string) {
  for (const [key, label] of rangeChoices) {
    const range = dateRange(key, timezone);
    if (range.start === start && range.end === end) return label;
  }
  return start + ' — ' + end;
}
