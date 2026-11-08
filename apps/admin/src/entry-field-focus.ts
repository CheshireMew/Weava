/** Route editable validation errors to their owning surface. Other errors stay readable text. */
export function entryFieldSection(path: string) {
  const key = path.split('.')[0];
  if (['path', 'author'].includes(key)) return 'information';
  if (['description', 'editorial'].includes(key)) return 'presentation';
  if (key === 'seo') return 'sharing';
  if (key === 'compatibility') return 'advanced';
  if (['title', 'document', 'blocks'].includes(key) || path.startsWith('fields.')) return 'writing';
  return null;
}

/** Wait until dialog cleanup has restored the page, then reveal nested repeat editors as needed. */
export function focusEntryField(root: HTMLElement, path: string) {
  let frame = 0;
  let remaining = path.split('.').length;
  const reveal = () => {
    if (!root.isConnected) return;
    const field = [...root.querySelectorAll<HTMLElement>('[data-field-path]')]
      .filter(node => path === node.dataset.fieldPath || path.startsWith(node.dataset.fieldPath + '.'))
      .sort((a, b) => b.dataset.fieldPath!.length - a.dataset.fieldPath!.length)[0];
    if (!field) return;
    const edit = field.querySelector<HTMLButtonElement>(':scope > header [data-field-edit]');
    const nestedDialog = field.querySelector<HTMLElement>('dialog[open]');
    if (edit && !nestedDialog && remaining-- > 0) {
      edit.click();
      frame = requestAnimationFrame(reveal);
      return;
    }
    const selector = 'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[contenteditable="true"]';
    const scope = nestedDialog ?? field;
    const target = field.matches(selector) ? field : scope.querySelector<HTMLElement>(selector) ?? scope.querySelector<HTMLElement>('button:not([disabled])') ?? field;
    field.scrollIntoView({ block: 'center' });
    target.focus({ preventScroll: true });
  };
  frame = requestAnimationFrame(reveal);
  return () => cancelAnimationFrame(frame);
}
