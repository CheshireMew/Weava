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
