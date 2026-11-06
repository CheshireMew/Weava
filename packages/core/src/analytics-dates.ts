const dayMs = 86400000;
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
export function shiftDay(day: string, amount: number) {
  return new Date(Date.parse(day) + amount * dayMs).toISOString().slice(0, 10);
}
export function dayInZone(date: Date, zone: string) {
  let formatter = dayFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    if (dayFormatters.size >= 16) dayFormatters.delete(dayFormatters.keys().next().value!);
    dayFormatters.set(zone, formatter);
  }
  return formatter.format(date);
}
export function dayStart(day: string, zone: string) {
  const target = Date.parse(day);
  let instant = target;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let n = 0; n < 4; n++) {
    const p = Object.fromEntries(
      fmt.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
    );
    const local = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const delta = target - local;
    instant += delta;
    if (!delta) break;
  }
  return new Date(instant).toISOString();
}
export const validDay = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
