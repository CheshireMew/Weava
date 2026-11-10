/** Resolve a wall-clock value without consulting the browser's local timezone. */
export function zonedInstants(value: string, timeZone: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error('请选择完整的日期和时间。');
  const wall = value.length === 16 ? value + ':00' : value;
  const target = Date.parse(wall + 'Z');
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 19) !== wall) throw new Error('日期或时间无效。');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const local = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  };
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = target + hours * 3600000;
    offsets.add(Date.parse(local(sample) + 'Z') - sample);
  }
  return [...new Set([...offsets].map(offset => target - offset).filter(instant => local(instant) === wall))].sort((a, b) => a - b).map(instant => new Date(instant).toISOString());
}
export function zonedDateTime(value: string, timeZone: string, occurrence?: 'earlier' | 'later'): string {
  const matches = zonedInstants(value, timeZone);
  if (!matches.length) throw new Error('这个时间因夏令时切换而不存在，请选择其它时间。');
  if (matches.length > 1 && !occurrence) throw new Error('这个时间因夏令时切换出现两次，请选择第一次或第二次。');
  return occurrence === 'later' ? matches.at(-1)! : matches[0];
}
