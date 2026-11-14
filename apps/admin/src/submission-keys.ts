const storageKey = 'weava-pending-submissions:v1';
let pending: Map<string, string> | undefined;
function entries() {
  if (!pending) {
    try { pending = new Map(JSON.parse(sessionStorage.getItem(storageKey) ?? '[]')); }
    catch { pending = new Map(); }
  }
  return pending;
}
function persist() {
  try { sessionStorage.setItem(storageKey, JSON.stringify([...entries()])); } catch {}
}
export async function submissionKey(path: string, body: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([path, body])));
  const identity = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const key = entries().get(identity) ?? crypto.randomUUID();
  entries().set(identity, key); persist();
  return { key, finish: () => { if (entries().get(identity) === key) { entries().delete(identity); persist(); } } };
}
export function clearSubmissionKeys() { entries().clear(); persist(); }
