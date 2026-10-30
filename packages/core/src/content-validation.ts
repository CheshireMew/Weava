import { entrySchema, fieldDefaults, fieldIssues, effectiveFields, contentBlockIssues, WeavaError, type Entry, type FieldIssue } from '@weava/contracts';
import type { Site } from './site.ts';
import { normalizePath } from './site.ts';
import { renderDocument } from './documents.ts';
import { validateSeo } from './seo.ts';

export interface EntryCheck { valid: boolean; errors: FieldIssue[]; value?: Entry }
export function checkEntry(site: Site, value: unknown, options: { required?: boolean; references?: Entry[] } = {}): EntryCheck {
  const parsed = entrySchema.safeParse(value);
  if (!parsed.success) return { valid: false, errors: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message, code: issue.code })) };
  const input = parsed.data, errors: FieldIssue[] = [];
  const previous = site.store.get('entry', input.id)?.value;
  const run = (path: string, fn: () => void) => { try { fn(); } catch (error: any) { errors.push({ path, message: error.message, code: 'invalid' }); } };
  run('path', () => {
    input.path = normalizePath(input.path);
    if (/^\/(admin|api|_astro|_admin|media|__preview|__health)(\/|$)/.test(input.path)) throw new WeavaError('这个网址由系统使用。');
  });
  input.fields = { ...previous?.fields, ...input.fields };
  const definition = site.store.get('type', input.type)?.value;
  if (input.kind === 'content') {
    if (!definition) errors.push({ path: 'type', message: '内容类型不存在。', code: 'type' });
    else {
      errors.push(...contentBlockIssues(input.blocks,definition));
      let fields = definition.fields;
      run('fields', () => { fields = effectiveFields(definition.fields, site.fieldWidgets); });
      input.fields = fieldDefaults(fields, input.fields);
      const references = new Map((options.references ?? []).map((entry) => [entry.id, entry]));
      errors.push(...fieldIssues(fields, input.fields, { prefix: 'fields.', required: options.required,
        reference: (id) => id === input.id ? input : references.get(id) ?? site.store.get('entry', id)?.value,
        requireReferences: options.required !== false }));
    }
  }
  run('seo', () => validateSeo(input, site.settings().value.domain));
  run('document', () => { renderDocument(input.document); });
  run('blocks', () => {
    site.validateBlocks(input.blocks, options.required !== false);
    const body = (items: Entry['blocks']): boolean => items.some((block) => block.type === 'entry-body' || body(block.children ?? []));
    if (body(input.blocks)) throw new WeavaError('内容正文占位只用于模板，页面内容不能引用自身。');
  });
  return { valid: errors.length === 0, errors, value: input };
}

export function prepareEntryCandidate(site: Site, value: unknown, options: Parameters<typeof checkEntry>[2] = {}) {
  const result = checkEntry(site, value, options);
  if (!result.valid) throw new WeavaError(result.errors.map((error) => error.message).join('；'), 400, result.errors);
  return result.value!;
}
