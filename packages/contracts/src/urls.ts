/** Browser and server share protocol rules, including control normalization. */
export function safeContentUrl(value: unknown, media = false): boolean {
  if (typeof value !== 'string') return false;
  if (!value) return true;
  if (/[\x00-\x20\x7f\\]/.test(value) || value.startsWith('//')) return false;
  try {
    const url = new URL(value, 'https://weava.invalid/');
    return (media ? ['http:', 'https:'] : ['http:', 'https:', 'mailto:', 'tel:', 'entry:']).includes(url.protocol);
  } catch { return false; }
}
