import { effectiveFields, fieldPatterns, z, entrySchema, typeSchema, contentViewSchema, creationTemplateSchema, mediaGroupSchema, type FieldDefinition } from '@weava/contracts';
import type { Site } from './site.ts';
// Field declarations are the same source used by forms, save and publication validation.
function fieldsSchema(fields: FieldDefinition[]): z.ZodType {
  const properties: Record<string, z.ZodType> = {};
  for (const field of fields) {
    let value: z.ZodType;
    if (field.type === 'group') value = fieldsSchema(field.fields ?? []);
    else if (field.type === 'number') { let n = z.number().finite(); if (field.min !== undefined) n = n.min(field.min); if (field.max !== undefined) n = n.max(field.max); value = n; }
    else if (field.type === 'boolean') value = z.boolean();
    else if (field.type === 'select' && field.options?.length) value = z.enum(field.options as [string, ...string[]]);
    else { let text = z.string(); if (field.minLength !== undefined) text = text.min(field.minLength); if (field.maxLength !== undefined) text = text.max(field.maxLength); const [first, ...others] = fieldPatterns(field); if (first) text = text.regex(new RegExp(first, 'u')); value = text; for (const pattern of others) value = z.intersection(value, z.string().regex(new RegExp(pattern, 'u'))); }
    if (field.multiple) { let array = z.array(value); if (field.minItems !== undefined) array = array.min(field.minItems); if (field.maxItems !== undefined) array = array.max(field.maxItems); value = array; }
    if (!field.required || field.condition) value = value.optional();
    if (field.defaultValue !== undefined) value = value.default(field.defaultValue);
    properties[field.key] = value.describe(field.label);
  }
  return z.object(properties).passthrough();
}
const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' });
export function siteSchema(site: Site) {
  const types = site.store.list('type').map((row) => ({ id: row.id, revision: row.revision, definition: row.value, schema: jsonSchema(entrySchema.extend({ type: z.literal(row.id), fields: fieldsSchema(effectiveFields(row.value.fields, site.fieldWidgets)) })) }));
  return { version: 1, schemas: { Entry: jsonSchema(entrySchema), ContentType: jsonSchema(typeSchema), ContentView: jsonSchema(contentViewSchema), CreationTemplate: jsonSchema(creationTemplateSchema), MediaGroup: jsonSchema(mediaGroupSchema) }, types,
    rules: { conditions: 'Hidden fields retain values and skip validation; evaluate definition.condition using sibling data.', references: 'IDs must satisfy referenceTypes/referenceFilters; publication checks the selected public revision.', concurrency: 'Update requests require the revision returned by the last read. 409 requires rereading and resolving the conflict.', publication: 'Saving creates a working revision. Publish requires a separate frozen publication review.' } };
}
export function siteOpenApi(site: Site) {
  const schemas = siteSchema(site), ref = (name: string) => ({ $ref: '#/components/schemas/' + name });
  const envelope = (name: string) => ({ type: 'object', required: ['value', 'revision'], properties: { value: ref(name), revision: { type: ['integer', 'null'] } } });
  const operations: [string, string, any?][] = [['entry', '保存工作稿', envelope('Entry')], ['entry/check', '检查候选，不保存', { type: 'object', properties: { value: ref('Entry'), required: { type: 'boolean' } }, required: ['value'] }], ['types', '保存内容类型', envelope('ContentType')], ['authoring/views', '保存常用筛选', envelope('ContentView')], ['authoring/templates', '保存新建模板', envelope('CreationTemplate')], ['media/groups', '保存媒体分组', envelope('MediaGroup')]];
  return { openapi: '3.1.0', info: { title: site.settings().value.name + ' · Weava Authoring', version: '1' }, servers: [{ url: site.settings().value.domain }],
    security: [{ bearerAuth: [] }], components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }, schemas: { ...schemas.schemas, ...Object.fromEntries(schemas.types.map((type) => ['Entry_' + type.id, type.schema])) } },
    paths: Object.fromEntries(operations.map(([path, summary, body]) => ['/api/admin/v1/' + path, { post: { summary, requestBody: { required: true, content: { 'application/json': { schema: body } } }, responses: { '200': { description: '操作结果；entry/check 以 valid 与 errors 表示校验结果' }, '400': { description: '输入无效' }, '401': { description: '请重新登录' }, '409': { description: '修订冲突，请读取最新状态' } } } }])) };
}
export function siteTypes(site: Site) {
  const scalar = (field: FieldDefinition): string => {
    const value = field.type === 'group' ? shape(field.fields ?? []) : field.type === 'number' ? 'number' : field.type === 'boolean' ? 'boolean' : field.type === 'select' && field.options?.length ? field.options.map((option) => JSON.stringify(option)).join(' | ') : 'string';
    return field.multiple ? '(' + value + ')[]' : value;
  };
  const shape = (fields: FieldDefinition[]) => '{\n' + fields.map((field) => '  ' + JSON.stringify(field.key) + (field.required && !field.condition ? '' : '?') + ': ' + scalar(field) + ';').join('\n') + '\n}';
  const types = site.store.list('type');
  return '// Generated from this site. Regenerate after content-model changes.\nimport type { Entry as WeavaEntry } from "@weava/contracts";\n' + types.map((row, index) => `export type SiteEntry${index} = Omit<WeavaEntry, "type" | "fields"> & { type: ${JSON.stringify(row.id)}; fields: ${shape(row.value.fields)} };`).join('\n') + '\nexport type SiteEntry = ' + (types.map((_, index) => 'SiteEntry' + index).join(' | ') || 'never') + ';\n';
}
