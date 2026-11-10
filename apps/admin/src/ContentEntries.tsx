import {ArrowUpRight,Eye,FileText,Heart,MessageCircle} from 'lucide-react';
import type {ContentLibraryModel} from './content-models.ts';
import {entryStatus} from './EntryStatus.tsx';
import {EntryActions} from './EntryActions.tsx';
import {ScheduleSummary} from './ScheduleSummary.tsx';

const date = (value: string) => new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
function valueFor(row: any, key: string) {
  const value = key === 'updatedAt' ? row.updatedAt : key === 'publishedAt' ? row.value.publishedAt : row.value.fields?.[key];
  if (value === undefined || value === null || value === '') return '—';
  if (key === 'updatedAt' || key === 'publishedAt') return date(value);
  if (Array.isArray(value)) return value.length + ' 项';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return typeof value === 'object' ? '字段组' : String(value);
}

export function ContentEntries({ model, selectable = false, showType = false }: { model: Pick<ContentLibraryModel,'timezone'|'items'|'state'|'libraryLoading'|'filter'|'searchTerm'|'bulkIds'|'setBulkIds'|'select'|'tab'|'busy'|'actions'>; selectable?: boolean; showType?: boolean }) {
  const { items, state, libraryLoading, filter, searchTerm, bulkIds, setBulkIds, select, tab } = model;
  const disabled = libraryLoading || filter !== searchTerm || model.busy;
  const selected = items.length > 0 && items.every((row: any) => bulkIds.includes(row.id));
  return <div className="publication-list" role="list" aria-label={tab === 'pages' ? '页面目录' : '内容目录'}>
    {selectable && <div className="publication-select-all"><label><input type="checkbox" aria-label="全选本页内容" disabled={disabled || !items.length} checked={selected}
      ref={input => { if (input) input.indeterminate = !selected && items.some((row: any) => bulkIds.includes(row.id)); }}
      onChange={event => { const checked = event.currentTarget.checked; setBulkIds(ids => checked ? [...new Set([...ids, ...items.map((row: any) => row.id)])] : ids.filter(id => !items.some((row: any) => row.id === id))); }} />全选本页</label></div>}
    {items.map((row: any) => {
      const type = state.types.find((item: any) => item.id === row.value.type)?.value;
      const status = entryStatus(row);
      const published = !!row.published;
      const publishedAt = row.publication?.publishedAt ?? row.value.publishedAt;
      const publishedPath = row.publication?.path ?? row.value.path;
      const columns: string[] = type?.admin?.columns ?? ['status', ...(tab === 'content' ? ['type'] : []), 'updatedAt'];
      const custom = columns.filter(key => !['title', 'status', 'type', 'updatedAt', 'publishedAt'].includes(key));
      return <article role="listitem" className={'publication-row' + (bulkIds.includes(row.id) ? ' checked' : '')} key={row.id}>
        {selectable && <label className="publication-selection"><input type="checkbox" disabled={disabled} aria-label={'批量选择 ' + row.value.title} checked={bulkIds.includes(row.id)} onChange={event => { const checked = event.currentTarget.checked; setBulkIds(ids => checked ? [...ids, row.id] : ids.filter(id => id !== row.id)); }} /></label>}
        <button className="publication-open" disabled={model.busy} onClick={() => select(row.id)}>
          <span className="publication-cover" aria-hidden="true">{row.value.cover ? <img src={row.thumbnail ?? row.value.cover} srcSet={row.thumbnailSrcset} sizes={row.thumbnailSizes} alt="" loading="lazy" decoding="async" /> : <FileText size={26} strokeWidth={1.4} />}</span>
          <span className="publication-copy"><span className="publication-title">{row.value.title || '无标题'}</span>
            {tab === 'pages' && <span className="publication-page-path">{row.value.path === '/' ? '首页' : row.value.path}</span>}
            <span className="publication-meta">
              {showType && <span className="publication-type">{type?.label ?? row.value.type}</span>}
              {published && publishedAt ? <time dateTime={publishedAt}>发布于 {date(publishedAt)}</time> : columns.includes('updatedAt') && <time dateTime={row.updatedAt}>更新于 {date(row.updatedAt)}</time>}
              <span>{status.key === 'changed' ? '已发布（有未发布修改）' : status.label}</span>
              {row.value.visibility === 'private' && <span>私密</span>}
            </span>
            {published && row.metrics && <span className="publication-metrics">
              {([['likes',Heart,'点赞'],['comments',MessageCircle,'评论'],['views',Eye,'浏览量']] as const).map(([key,Icon,label]) => row.metrics[key] !== undefined && <span key={key} aria-label={label+'：'+row.metrics[key]} title={label}><Icon size={15} aria-hidden="true"/>{row.metrics[key].toLocaleString('zh-CN')}</span>)}
            </span>}
            {custom.length > 0 && <span className="publication-custom">{custom.map(key => <span key={key}>{type?.fields.find((field: any) => field.key === key)?.label ?? key}：{valueFor(row, key)}</span>)}</span>}
          </span>
        </button>
        {!!row.schedules?.length&&<ScheduleSummary items={row.schedules} timezone={model.timezone} onError={model.actions.setError}/>}
        {published && publishedPath && <a className="publication-visit" href={publishedPath} target="_blank" rel="noopener noreferrer" aria-label={'打开'+(type?.label ?? '内容')+'：'+row.value.title} title={'打开'+(type?.label ?? '内容')}><ArrowUpRight size={20} aria-hidden="true"/></a>}
        <EntryActions row={row} model={model.actions} disabled={disabled || model.busy} />
      </article>;
    })}
  </div>;
}
