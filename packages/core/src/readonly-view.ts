/** Preserve lazy bodies while exposing a deeply read-only view of cached JSON. */
const views = new WeakMap<object, object>();
export type ReadonlyData<T> = T extends (...args: any[]) => any ? T : T extends object ? {readonly [K in keyof T]: ReadonlyData<T[K]>} : T;
export function readonlyView<T>(value: T): ReadonlyData<T> {
  if (!value || typeof value !== 'object') return value as ReadonlyData<T>;
  const known = views.get(value);
  if (known) return known as ReadonlyData<T>;
  const view: any = Array.isArray(value) ? new Array(value.length) : {};
  views.set(value, view);
  for (const name of Object.keys(value)) Object.defineProperty(view, name, {
    enumerable: true,
    get: () => readonlyView((value as any)[name]),
  });
  return Object.freeze(view) as ReadonlyData<T>;
}
