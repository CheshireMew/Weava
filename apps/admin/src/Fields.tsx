import { createContext, useContext, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { fieldVisible, fieldDefaults, effectiveFields, type ContentType, type FieldDefinition, type FieldIssue, type FieldWidget } from '@weava/contracts';
import { ReferenceField } from './ReferenceField.tsx';
import { useSelectors } from './Selectors.tsx';

const blank = (field: FieldDefinition) => field.type === 'group' ? fieldDefaults(field.fields ?? []) : field.type === 'boolean' ? false : field.type === 'number' ? 0 : '';
const scalar = (value: string, type?: string) => type === 'number' ? value === '' ? '' : Number(value) : type === 'boolean' ? value === 'true' : value;

const Widgets = createContext<Record<string, FieldWidget>>({});
export function FieldWidgetsProvider({ value, children }: { value: Record<string, FieldWidget>; children: ReactNode }) { return <Widgets.Provider value={value}>{children}</Widgets.Provider>; }
export function Fields({ definitions, values, onChange, layout, errors = [], prefix = 'fields.' }: {
  definitions: FieldDefinition[]; values: Record<string, any>; onChange: (value: any) => void;
  layout?: NonNullable<ContentType['admin']>['fields'];
  errors?: FieldIssue[]; prefix?: string;
}) {
  const selectors = useSelectors(), widgets = useContext(Widgets);
  try { definitions = effectiveFields(definitions, widgets); } catch { /* Missing extensions retain their base field editor and the warning below. */ }
  const ordered = layout?.length ? [...layout.map((item) => definitions.find((field) => field.key === item.key)).filter((field): field is FieldDefinition => !!field), ...definitions.filter((field) => !layout.some((item) => item.key === field.key))] : definitions;
  return <div className="custom-fields-grid">{ordered.filter((field) => fieldVisible(field, values)).map((field) => {
    const value = values[field.key], set = (next: any) => onChange({ ...values, [field.key]: next });
    const widget = field.widget ? widgets[field.widget] : null;
    const path = prefix + field.key, issues = errors.filter((error) => error.path === path);
    return <div className={'custom-field ' + (layout?.find((item) => item.key === field.key)?.width === 'half' ? 'half' : '')} key={field.key} data-field-path={path}>
      {field.multiple ? <RepeatedField field={field} value={Array.isArray(value) ? value : []} onChange={set} errors={errors} path={path} /> : field.type === 'group' ? <fieldset><legend>{field.label}</legend><Fields definitions={field.fields ?? []} values={value ?? {}} onChange={set} prefix={path + '.'} errors={errors} /></fieldset> : <label><span>{field.label}{field.required && <span aria-hidden="true"> *</span>}</span>
        {widget ? widget.control === 'textarea' ? <textarea aria-label={field.label} value={value ?? ''} onChange={(event) => set(event.target.value)} /> : <span className="widget-input"><input aria-label={field.label} type={widget.control} value={value ?? (widget.control === 'color' ? '#000000' : '')} min={field.min ?? widget.min} max={field.max ?? widget.max} onChange={(event) => set(scalar(event.target.value, field.type))} />{widget.control === 'range' && <output>{value ?? ''}</output>}</span> : field.type === 'boolean' ? <input aria-label={field.label} aria-required={field.required} type="checkbox" checked={!!value} onChange={(event) => set(event.target.checked)} /> : field.type === 'select' ? <select aria-label={field.label} aria-required={field.required} value={value ?? ''} onChange={(event) => set(event.target.value)}><option value="">请选择</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select>
          : field.type === 'reference' ? <ReferenceField value={value ?? ''} onChange={set} definition={field} />
          : field.type === 'media' ? <span className="selector-field"><input value={value ?? ''} onChange={(event) => set(event.target.value)} /><button type="button" onClick={async () => { const media = await selectors.media(); if (media) set(media.url); }}>选择媒体</button></span>
          : field.type === 'richtext' ? <textarea aria-label={field.label} aria-required={field.required} value={value ?? ''} onChange={(event) => set(event.target.value)} />
          : <input aria-label={field.label} aria-required={field.required} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} value={value ?? ''} min={field.min} max={field.max} onChange={(event) => set(scalar(event.target.value, field.type))} />}
      </label>}
      {field.widget && !widget && <p className="error">字段输入器不可用：{field.widget}</p>}
      {issues.map((issue) => <p key={issue.path + issue.code} className="error" role="alert">{issue.message}</p>)}
    </div>;
  })}</div>;
}

function RepeatedField({ field, value, onChange, errors, path }: { field: FieldDefinition; value: any[]; onChange: (value: any[]) => void; errors: FieldIssue[]; path: string }) {
  const keys = useRef<string[]>([]), drag = useRef<number | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  while (keys.current.length < value.length) keys.current.push(crypto.randomUUID());
  if (keys.current.length > value.length) keys.current.length = value.length;
  const move = (from: number, to: number) => {
    if (from < 0 || from >= value.length || to < 0 || to >= value.length || from === to) return;
    const next = [...value], [item] = next.splice(from, 1), [key] = keys.current.splice(from, 1);
    next.splice(to, 0, item); keys.current.splice(to, 0, key); onChange(next);
  };
  const drop = (event: DragEvent, index: number) => { event.preventDefault(); if (drag.current !== null) move(drag.current, index); drag.current = null; };
  return <fieldset className="repeated-field"><legend>{field.label}{field.required && <span aria-hidden="true"> *</span>}</legend>
    {value.map((item, index) => {
      const title = field.type === 'group' ? String(item?.[field.summaryField ?? 'title'] || item?.name || field.label) : String(item ?? field.label);
      const hasError = errors.some((error) => error.path.startsWith(path + '.' + index + '.') || error.path === path + '.' + index);
      const key = keys.current[index], toggle = () => setExpanded((old) => ({ ...old, [key]: !old[key] }));
      return <details key={key} open={hasError || !!expanded[key]} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, index)}>
        <summary onClick={(event) => { if ((event.target as HTMLElement).closest('button')) return; event.preventDefault(); toggle(); }}><span><button type="button" aria-label={(expanded[key] || hasError ? '折叠' : '展开') + '第' + (index + 1) + '项'} onClick={(event) => { event.preventDefault(); toggle(); }}>{expanded[key] || hasError ? '▾' : '▸'}</button>{index + 1}. {title || field.label}</span><span className="repeat-actions">
          <button type="button" draggable aria-label={'拖动' + field.label + '第' + (index + 1) + '项'} onClick={(event) => event.preventDefault()} onDragStart={() => { drag.current = index; }} onDragEnd={() => { drag.current = null; }}>↕</button>
          <button type="button" aria-label={'上移第' + (index + 1) + '项'} disabled={index === 0} onClick={(event) => { event.preventDefault(); move(index, index - 1); }}>↑</button>
          <button type="button" aria-label={'下移第' + (index + 1) + '项'} disabled={index === value.length - 1} onClick={(event) => { event.preventDefault(); move(index, index + 1); }}>↓</button>
          <button type="button" onClick={(event) => { event.preventDefault(); keys.current.splice(index, 1); onChange(value.filter((_, i) => i !== index)); }}>移除</button>
        </span></summary>
        {field.type === 'group' ? <Fields definitions={field.fields ?? []} values={item ?? {}} onChange={(next) => onChange(value.map((old, i) => i === index ? next : old))} errors={errors} prefix={path + '.' + index + '.'} /> : <Fields definitions={[{ ...field, key: String(index), multiple: false, condition: undefined, minItems: undefined, maxItems: undefined }]} values={{ [index]: item }} onChange={(next) => onChange(value.map((old, i) => i === index ? next[index] : old))} errors={errors} prefix={path + '.'} />}
      </details>;
    })}
    <button type="button" disabled={field.maxItems !== undefined && value.length >= field.maxItems} onClick={() => { const key = crypto.randomUUID(); keys.current.push(key); setExpanded((old) => ({ ...old, [key]: true })); onChange([...value, blank(field)]); }}>添加{field.label}</button>
  </fieldset>;
}

export function FieldDefinitions({ value, onChange, types = [] }: { value: FieldDefinition[]; onChange: (value: FieldDefinition[]) => void; types?: ContentType[] }) {
  const widgets = useContext(Widgets);
  const update = (index: number, patch: Partial<FieldDefinition>) => onChange(value.map((field, i) => i === index ? { ...field, ...patch } : field));
  return <div className="field-definitions"><h3>自定义字段</h3>{value.map((field, index) => <section key={index}>
    <div className="form-columns"><label>字段名称<input value={field.label} onChange={(event) => update(index, { label: event.target.value })} /></label><label>字段标识<input value={field.key} onChange={(event) => update(index, { key: event.target.value })} /></label><label>类型<select value={field.type} onChange={(event) => update(index, { type: event.target.value as FieldDefinition['type'], defaultValue: undefined, min: undefined, max: undefined, minLength: undefined, maxLength: undefined, referenceTypes: undefined, referenceFilters: undefined, summaryField: undefined, widget: undefined })}>{Object.entries({ text: '文字', richtext: '富文本', number: '数字', boolean: '开关', date: '日期', select: '选项', media: '媒体', reference: '内容引用', group: '字段组' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    {field.type === 'select' && <label>选项，以逗号分隔<input value={field.options?.join(',') ?? ''} onChange={(event) => update(index, { options: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /></label>}
    <div className="inline"><label><input type="checkbox" checked={!!field.required} onChange={(event) => update(index, { required: event.target.checked })} />必填</label><label><input type="checkbox" checked={!!field.multiple} onChange={(event) => update(index, { multiple: event.target.checked, defaultValue: undefined, minItems: undefined, maxItems: undefined })} />可重复</label>{['text', 'number', 'boolean', 'date', 'select', 'reference'].includes(field.type) && <label><input type="checkbox" checked={!!field.filterable} onChange={(event) => update(index, { filterable: event.target.checked })} />可用于列表筛选</label>}<button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))}>移除字段</button></div>
    {Object.keys(widgets).length > 0 && <label>输入方式<select value={field.widget ?? ''} onChange={(event) => update(index, { widget: event.target.value || undefined })}><option value="">默认</option>{Object.entries(widgets).filter(([, widget]) => widget.type === field.type).map(([id, widget]) => <option key={id} value={id}>{widget.label}</option>)}</select></label>}
    <details><summary>字段规则</summary><div className="form-columns">
      {(field.type === 'number' ? [['min', '最小值'], ['max', '最大值']] : ['text', 'richtext'].includes(field.type) ? [['minLength', '最少字数'], ['maxLength', '最多字数']] : []).concat(field.multiple ? [['minItems', '最少项数'], ['maxItems', '最多项数']] : []).map(([key, label]) => <label key={key}>{label}<input type="number" value={(field as any)[key] ?? ''} onChange={(event) => update(index, { [key]: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>)}
    </div><label><input type="checkbox" checked={field.defaultValue !== undefined} onChange={(event) => update(index, { defaultValue: event.target.checked ? field.multiple ? [] : blank(field) : undefined })} />新内容默认值</label>{field.defaultValue !== undefined && <Fields definitions={[{ ...field, condition: undefined, required: false, defaultValue: undefined }]} values={{ [field.key]: field.defaultValue }} prefix="default." onChange={(next) => update(index, { defaultValue: next[field.key] })} />}
      <label>显示条件<select value={field.condition?.field ?? ''} onChange={(event) => update(index, { condition: event.target.value ? { field: event.target.value, operator: 'hasValue' } : undefined })}><option value="">始终显示</option>{value.filter((item) => item.key !== field.key && !item.multiple && item.type !== 'group').map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>{field.condition && <div className="form-columns"><label>条件<select value={field.condition.operator} onChange={(event) => update(index, { condition: { ...field.condition!, operator: event.target.value as any, value: field.condition!.value ?? (value.find((item) => item.key === field.condition!.field)?.type === 'boolean' ? true : '') } })}><option value="hasValue">已填写</option><option value="equals">等于</option><option value="notEquals">不等于</option></select></label>{field.condition.operator !== 'hasValue' && <label>比较值<input value={String(field.condition.value ?? '')} onChange={(event) => update(index, { condition: { ...field.condition!, value: scalar(event.target.value, value.find((item) => item.key === field.condition!.field)?.type) } })} /></label>}</div>}
      {field.type === 'reference' && <><label>允许的内容类型<input aria-label={field.label + '允许的内容类型'} placeholder="留空允许全部；多个标识以逗号分隔" value={field.referenceTypes?.join(',') ?? ''} list={'reference-types-' + field.key} onChange={(event) => { const items = event.target.value.split(',').map((item) => item.trim()).filter(Boolean); update(index, { referenceTypes: items.length ? items : undefined }); }} /><datalist id={'reference-types-' + field.key}>{types.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</datalist></label><ReferenceFilters value={field.referenceFilters ?? {}} types={types.filter((type) => field.referenceTypes?.includes(type.id))} onChange={(filters) => update(index, { referenceFilters: Object.keys(filters).length ? filters : undefined })} /></>}
    </details>
    {field.type === 'group' && <><label>折叠后的标题字段<select value={field.summaryField ?? ''} onChange={(event) => update(index, { summaryField: event.target.value || undefined })}><option value="">自动</option>{field.fields?.filter((item) => !item.multiple && item.type !== 'group').map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><FieldDefinitions value={field.fields ?? []} types={types} onChange={(fields) => update(index, { fields })} /></>}
  </section>)}<button type="button" onClick={() => { let n = value.length + 1; while (value.some((field) => field.key === 'field' + n)) n++; onChange([...value, { key: 'field' + n, label: '新字段', type: 'text' }]); }}>添加字段</button></div>;
}

function ReferenceFilters({ value, types, onChange }: { value: Record<string, any>; types: ContentType[]; onChange: (value: Record<string, any>) => void }) {
  const listId = useId();
  const fields = types.flatMap((type) => type.fields).filter((field, index, all) => !['group', 'richtext'].includes(field.type) && all.findIndex((other) => other.key === field.key) === index);
  return <div>{Object.entries(value).map(([key, expected], index) => <div className="form-columns" key={index}><label>关联条件字段<input value={key} onChange={(event) => onChange(Object.fromEntries(Object.entries(value).map(([old, val]) => [old === key ? event.target.value : old, val])))} list={listId} /></label><label>等于<input value={String(expected)} onChange={(event) => onChange({ ...value, [key]: scalar(event.target.value, fields.find((field) => field.key === key)?.type) })} /></label><button type="button" onClick={() => onChange(Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)))}>移除条件</button></div>)}<datalist id={listId}>{fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</datalist><button type="button" onClick={() => onChange({ ...value, [fields.find((field) => !(field.key in value))?.key ?? 'condition']: '' })}>添加关联条件</button></div>;
}

export function TypeAdminLayout({ type, onChange }: { type: ContentType; onChange: (admin: NonNullable<ContentType['admin']>) => void }) {
  const admin = type.admin ?? {}, configured = admin.fields ?? [];
  const rows = [...configured.filter((item) => type.fields.some((field) => field.key === item.key)), ...type.fields.filter((field) => !configured.some((item) => item.key === field.key)).map((field) => ({ key: field.key, width: 'full' as const }))];
  const move = (from: number, to: number) => { const fields = [...rows], [field] = fields.splice(from, 1); fields.splice(to, 0, field); onChange({ ...admin, fields }); };
  const columns = [{ key: 'title', label: '标题' }, { key: 'status', label: '状态' }, { key: 'updatedAt', label: '修改时间' }, { key: 'publishedAt', label: '发布时间' }, ...type.fields.map((field) => ({ key: field.key, label: field.label }))];
  return <details className="type-admin-layout"><summary>后台布局</summary>
    {rows.map((row, index) => <div className="type-field-row" key={row.key}><span>{type.fields.find((field) => field.key === row.key)?.label}</span><label>宽度<select aria-label="宽度" value={row.width} onChange={(event) => onChange({ ...admin, fields: rows.map((item) => item.key === row.key ? { ...item, width: event.target.value as 'full' | 'half' } : item) })}><option value="full">整行</option><option value="half">半行</option></select></label><button type="button" disabled={index === 0} aria-label={'上移字段' + row.key} onClick={() => move(index, index - 1)}>↑</button><button type="button" disabled={index === rows.length - 1} aria-label={'下移字段' + row.key} onClick={() => move(index, index + 1)}>↓</button></div>)}
    <fieldset><legend>列表显示</legend>{columns.map((column) => <label className="inline" key={column.key}><input type="checkbox" disabled={column.key === 'title'} checked={column.key === 'title' || (admin.columns ?? ['title', 'status']).includes(column.key)} onChange={(event) => onChange({ ...admin, columns: event.target.checked ? [...(admin.columns ?? ['title', 'status']), column.key] : (admin.columns ?? ['title', 'status']).filter((key) => key !== column.key) })} />{column.label}</label>)}</fieldset>
    <label>默认排序<select value={admin.sort ?? 'title'} onChange={(event) => onChange({ ...admin, sort: event.target.value as NonNullable<ContentType['admin']>['sort'] })}>{Object.entries({ title: '标题升序', '-title': '标题降序', updatedAt: '修改时间升序', '-updatedAt': '最近修改', publishedAt: '发布时间升序', '-publishedAt': '最近发布' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
  </details>;
}
