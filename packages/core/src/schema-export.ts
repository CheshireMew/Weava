import { authoringOpenApi } from '../../contracts/src/api-openapi.ts';
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
  const schemas = siteSchema(site);
  return authoringOpenApi(site.settings().value.name, site.settings().value.domain, { ...schemas.schemas, ...Object.fromEntries(schemas.types.map((type) => ['Entry_' + type.id, type.schema])) });
}

export function siteTypes(site: Site) {
  const scalar = (field: FieldDefinition): string => {
    const value = field.type === 'group' ? shape(field.fields ?? []) : field.type === 'number' ? 'number' : field.type === 'boolean' ? 'boolean' : field.type === 'select' && field.options?.length ? field.options.map((option) => JSON.stringify(option)).join(' | ') : 'string';
    return field.multiple ? '(' + value + ')[]' : value;
  };
  const shape = (fields: FieldDefinition[]) => '{\n' + fields.map((field) => '  ' + JSON.stringify(field.key) + (field.required && !field.condition ? '' : '?') + ': ' + scalar(field) + ';').join('\n') + '\n}';
  const types = site.store.list('type');
  return '// Generated from this site. Regenerate after content-model changes.\nimport type { Entry as WeavaEntry } from "@weava/contracts";\nexport type { ApiOperation, ApiInput, ApiOutput } from "@weava/contracts/api";\nexport { createAdminClient } from "@weava/contracts/api-client";\n' + types.map((row, index) => `export type SiteEntry${index} = Omit<WeavaEntry, "type" | "fields"> & { type: ${JSON.stringify(row.id)}; fields: ${shape(row.value.fields)} };`).join('\n') + '\nexport type SiteEntry = ' + (types.map((_, index) => 'SiteEntry' + index).join(' | ') || 'never') + ';\n';
}
