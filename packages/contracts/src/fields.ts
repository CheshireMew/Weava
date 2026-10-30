import type { Entry, FieldDefinition, FieldWidget } from './index.ts';
export type EffectiveFieldDefinition = FieldDefinition & { validationPatterns?: string[] };
export function fieldPatterns(field: FieldDefinition): string[] { return [...new Set([field.pattern, ...((field as EffectiveFieldDefinition).validationPatterns ?? [])].filter((value): value is string => !!value))]; }
export function effectiveFields(fields: FieldDefinition[], widgets: Record<string, FieldWidget>): EffectiveFieldDefinition[] {
  return fields.map((field) => {
    const widget = field.widget ? widgets[field.widget] : null;
    if (field.widget && !widget) throw new Error('字段输入器不可用：' + field.widget);
    if (widget && widget.type !== field.type) throw new Error('字段输入器的基础类型不匹配：' + field.label);
    const result: EffectiveFieldDefinition = { ...field, ...(field.fields ? { fields: effectiveFields(field.fields, widgets) } : {}) };
    if (widget) {
      for (const key of ['min','minLength'] as const) if (widget[key] !== undefined) result[key] = Math.max(field[key] ?? -Infinity, widget[key]!);
      for (const key of ['max','maxLength'] as const) if (widget[key] !== undefined) result[key] = Math.min(field[key] ?? Infinity, widget[key]!);
      const patterns = [...new Set([...fieldPatterns(field), widget.pattern, widget.control === 'color' ? '^#[a-fA-F0-9]{6}$' : undefined].filter((value): value is string => !!value))];
      result.pattern = patterns[0]; result.validationPatterns = patterns.slice(1);
    }
    return result;
  });
}

export interface FieldIssue { path: string; message: string; code: string }
const empty = (value: unknown) => value === undefined || value === null || value === '' || Array.isArray(value) && value.length === 0;
export function fieldVisible(field: FieldDefinition, siblings: Record<string, any>) {
  const rule = field.condition;
  if (!rule) return true;
  const value = siblings[rule.field];
  return rule.operator === 'hasValue' ? !empty(value) : rule.operator === 'equals' ? value === rule.value : value !== rule.value;
}

/** Defaults fill absent values only. A cleared field stays cleared; arrays are never padded. */
export function fieldDefaults(definitions: FieldDefinition[], values: Record<string, any> = {}): Record<string, any> {
  const result = structuredClone(values);
  for (const field of definitions) {
    if (result[field.key] === undefined && field.defaultValue !== undefined) result[field.key] = structuredClone(field.defaultValue);
    const value = result[field.key];
    if (field.type === 'group' && value && typeof value === 'object') {
      result[field.key] = field.multiple && Array.isArray(value) ? value.map((item) => item && typeof item === 'object' && !Array.isArray(item) ? fieldDefaults(field.fields ?? [], item) : item)
        : !Array.isArray(value) ? fieldDefaults(field.fields ?? [], value) : value;
    }
  }
  return result;
}

export function referenceMatches(field: FieldDefinition, entry: Pick<Entry, 'kind' | 'type' | 'fields'>) {
  return (!field.referenceTypes || entry.kind === 'content' && field.referenceTypes.includes(entry.type)) &&
    Object.entries(field.referenceFilters ?? {}).every(([key, expected]) => Array.isArray(entry.fields[key]) ? entry.fields[key].includes(expected) : entry.fields[key] === expected);
}

export function fieldIssues(definitions: FieldDefinition[], values: Record<string, any>, options: {
  required?: boolean; prefix?: string; reference?: (id: string) => Pick<Entry, 'kind' | 'type' | 'fields'> | undefined;
  requireReferences?: boolean;
} = {}): FieldIssue[] {
  const errors: FieldIssue[] = [];
  const issue = (path: string, message: string, code = 'invalid') => errors.push({ path, message, code });
  const visit = (defs: FieldDefinition[], siblings: Record<string, any>, prefix: string) => {
    for (const field of defs) {
      if (!fieldVisible(field, siblings)) continue;
      const value = siblings[field.key], path = prefix + field.key, label = field.label;
      if (empty(value)) {
        if (field.required && options.required !== false) issue(path, '请填写' + label, 'required');
        // An explicitly supplied empty list still has to respect its lower bound.
        if (Array.isArray(value) && field.multiple && field.minItems && field.minItems > 0) issue(path, label + '至少需要 ' + field.minItems + ' 项', 'minItems');
        continue;
      }
      if (field.multiple && !Array.isArray(value)) { issue(path, label + '需要列表'); continue; }
      const items = field.multiple ? value : [value];
      if (field.multiple) {
        if (field.minItems !== undefined && items.length < field.minItems) issue(path, label + '至少需要 ' + field.minItems + ' 项', 'minItems');
        if (field.maxItems !== undefined && items.length > field.maxItems) issue(path, label + '最多允许 ' + field.maxItems + ' 项', 'maxItems');
      }
      items.forEach((item: any, index: number) => {
        const itemPath = field.multiple ? path + '.' + index : path;
        if (field.type === 'group') {
          if (!item || typeof item !== 'object' || Array.isArray(item)) issue(itemPath, label + '需要字段组');
          else visit(field.fields ?? [], item, itemPath + '.');
          return;
        }
        const expected = field.type === 'number' ? 'number' : field.type === 'boolean' ? 'boolean' : 'string';
        if (typeof item !== expected || expected === 'number' && !Number.isFinite(item)) { issue(itemPath, label + '需要' + (expected === 'number' ? '数字' : expected === 'boolean' ? '布尔值' : '文字')); return; }
        if (field.type === 'number') {
          if (field.min !== undefined && item < field.min) issue(itemPath, label + '不能小于 ' + field.min, 'min');
          if (field.max !== undefined && item > field.max) issue(itemPath, label + '不能大于 ' + field.max, 'max');
        }
        if (typeof item === 'string') {
          if (fieldPatterns(field).some((pattern) => !new RegExp(pattern, 'u').test(item))) issue(itemPath, label + '格式无效', 'pattern');
          const length = [...item].length;
          if (field.minLength !== undefined && length < field.minLength) issue(itemPath, label + '至少需要 ' + field.minLength + ' 个字', 'minLength');
          if (field.maxLength !== undefined && length > field.maxLength) issue(itemPath, label + '最多允许 ' + field.maxLength + ' 个字', 'maxLength');
        }
        if (field.type === 'date' && !Number.isFinite(Date.parse(item))) issue(itemPath, label + '的日期无效');
        if (field.type === 'select' && !field.options?.includes(item)) issue(itemPath, label + '选项无效');
        if (field.type === 'reference' && options.reference && item) {
          const target = options.reference(item);
          if (!target && (options.requireReferences || field.referenceTypes || field.referenceFilters)) issue(itemPath, label + '关联内容不存在', 'reference');
          else if (target && !referenceMatches(field, target)) issue(itemPath, label + '关联内容不符合类型或筛选条件', 'reference');
        }
      });
    }
  };
  visit(definitions, values, options.prefix ?? '');
  return errors;
}

export function fieldDefinitionIssues(definitions: FieldDefinition[], prefix = ''): FieldIssue[] {
  const errors: FieldIssue[] = [], keys = new Set<string>();
  for (const field of definitions) {
    const path = prefix + field.key, add = (message: string) => errors.push({ path, message: field.label + '：' + message, code: 'definition' });
    if (keys.has(field.key)) add('字段名称重复');
    keys.add(field.key);
    for (const [low, high] of [['min', 'max'], ['minLength', 'maxLength'], ['minItems', 'maxItems']] as const) {
      if (field[low] !== undefined && field[high] !== undefined && field[low]! > field[high]!) add('最小值不能大于最大值');
    }
    if ((field.min !== undefined || field.max !== undefined) && field.type !== 'number') add('只有数字字段支持数值范围');
    if ((field.minLength !== undefined || field.maxLength !== undefined) && !['text', 'richtext'].includes(field.type)) add('只有文字字段支持长度限制');
    if ((field.minItems !== undefined || field.maxItems !== undefined) && !field.multiple) add('数量限制需要开启重复字段');
    if ((field.referenceTypes || field.referenceFilters) && field.type !== 'reference') add('只有内容引用字段支持关联限制');
    if (field.condition && (field.condition.field === field.key || !definitions.some((item) => item.key === field.condition!.field))) add('显示条件需要引用同组内的其它字段');
    if (field.condition && field.condition.operator !== 'hasValue' && field.condition.value === undefined) add('显示条件缺少比较值');
    if (field.summaryField && (field.type !== 'group' || !field.fields?.some((item) => item.key === field.summaryField && !item.multiple && item.type !== 'group'))) add('摘要标题需要选择组内的普通字段');
    let validPatterns = true;
    for (const pattern of fieldPatterns(field)) { try { new RegExp(pattern, 'u'); } catch { validPatterns = false; add('格式表达式无效'); } }
    if (validPatterns && field.defaultValue !== undefined) errors.push(...fieldIssues([{ ...field, required: false, condition: undefined }], { [field.key]: field.defaultValue }, { prefix }));
    if (field.fields) errors.push(...fieldDefinitionIssues(field.fields, path + '.'));
  }
  return errors;
}
