import { Popover } from './Popover.tsx';
import { Plus, Search, SlidersHorizontal } from 'lucide-react';
import { type FieldDefinition } from '@weava/contracts';

import { SavedViewControls } from './AuthoringControls.tsx';
import { ContentEntries } from './ContentEntries.tsx';

import type { ContentWorkspace } from './useContentWorkspace.ts';

export function ContentLibrary({ model, showBulkEditing = false, showSavedViews = false }: {
  model: ContentWorkspace;
  showBulkEditing?: boolean;
  showSavedViews?: boolean;
}) {
  const {
    record,
    persist,
    select,
    state,
    tab,
    setError,
    refresh,
    libraryLoading,
    filter,
    setFilter,
    status,
    setStatus,
    visibility,
    setVisibility,
    searchTerm,
    libraryPage,
    setLibraryPage,
    library,
    libraryType,
    setLibraryType,
    librarySort,
    setLibrarySort,
    bulkIds,
    setBulkIds,
    setBulkOpen,
    fieldFilters,
    setFieldFilters,
    items,
    newEntry,
  } = model;
  const hasFilters = !!filter || status !== 'all' || visibility !== 'all' || !!libraryType || Object.values(fieldFilters).some(Boolean);
  const sortControl = <select aria-label="内容排序" value={librarySort || state.types.find((row: any) => row.id === libraryType)?.value.admin?.sort || '-updatedAt'} onChange={event => { setLibrarySort(event.target.value); setLibraryPage(1); }}>
    {Object.entries({ title: '标题升序', '-title': '标题降序', '-updatedAt': '最近修改', '-publishedAt': '最近发布', oldest: '最早发布' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
  </select>;

  return (
    <section className="library" aria-label="内容列表" tabIndex={-1}>
      <div className="library-header">
        <div className="library-title">
          <h1>内容</h1>
        </div>
      </div>
      <div className="library-overview">
        <div className="library-status-tabs" role="group" aria-label="内容状态">
          {Object.entries({ all: '全部', published: '已发布', draft: '草稿' }).map(([key, label]) => <button key={key} aria-pressed={status === key} onClick={() => setStatus(key)}>{label}</button>)}
        </div>
        <button className="primary library-create" aria-label="新建" title={'新建内容'} onClick={newEntry}>
          <Plus size={18} />新建内容
        </button>
      </div>
      <div className="library-tools">
        <div className="library-search">
          <Search size={15} />
          <input
            aria-label="搜索内容"
            placeholder="搜索标题或摘要"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="library-filters">
          <Popover label="筛选内容" className="library-filter-popover" trigger={<><SlidersHorizontal size={17} aria-hidden="true" />筛选</>}><div className="library-secondary-filters">
          <select aria-label="更多内容状态" value={status} onChange={event => { setStatus(event.target.value); setLibraryPage(1); }}>
            <option value="all">全部状态</option><option value="published">已发布</option><option value="draft">草稿</option><option value="changed">有未发布修改</option><option value="archived">已归档</option>
          </select><select
            aria-label="内容可见性"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
            <option value="all">全部可见性</option>
            <option value="public">公开</option>
            <option value="private">私密</option>
          </select>
          {tab === 'content' && (
            <select
              aria-label="筛选内容类型"
              value={libraryType}
              onChange={(event) => {
                setLibraryType(event.target.value);
                setFieldFilters({});
                setLibrarySort('');
              }}
            >
              <option value="">全部类型</option>
              {state.types.map((type: any) => (
                <option key={type.id} value={type.id}>
                  {type.value.label}
                </option>
              ))}
            </select>
          )}
          {tab === 'content' &&
            state.types
              .find((row: any) => row.id === libraryType)
              ?.value.fields.filter((field: FieldDefinition) => field.filterable)
              .map((field: FieldDefinition) => (
                <label className="library-field-filter" key={field.key}>
                  {field.label}
                  {field.type === 'select' || field.type === 'boolean' ? (
                    <select
                      aria-label={'筛选' + field.label}
                      value={fieldFilters[field.key] ?? ''}
                      onChange={(event) =>
                        setFieldFilters({ ...fieldFilters, [field.key]: event.target.value })
                      }
                    >
                      <option value="">全部</option>
                      {(field.type === 'boolean' ? ['true', 'false'] : (field.options ?? [])).map(
                        (option) => (
                          <option key={option} value={option}>
                            {field.type === 'boolean' ? (option === 'true' ? '是' : '否') : option}
                          </option>
                        ),
                      )}
                    </select>
                  ) : (
                    <input
                      aria-label={'筛选' + field.label}
                      type={
                        field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'
                      }
                      value={fieldFilters[field.key] ?? ''}
                      onChange={(event) =>
                        setFieldFilters({ ...fieldFilters, [field.key]: event.target.value })
                      }
                    />
                  )}
                </label>
              ))}
          </div></Popover>
          {sortControl}
        </div>
        {showSavedViews && <Popover label="常用筛选" trigger="常用筛选"><SavedViewControls
          key={tab}
          views={state.contentViews ?? []}
          query={{
            kind: 'content',
            type: libraryType || undefined,
            query: filter || undefined,
            status: status as any,
            visibility: visibility as any,
            fields: fieldFilters,
            sort: (librarySort ||
              state.types.find((row: any) => row.id === libraryType)?.value.admin?.sort ||
              '-updatedAt') as any,
          }}
          apply={(query) => {
            setFilter(query.query ?? '');
            setStatus(query.status ?? 'all');
            setVisibility(query.visibility ?? 'all');
            setLibraryType(query.type ?? '');
            setFieldFilters(
              Object.fromEntries(
                Object.entries(query.fields ?? {}).map(([key, value]) => [key, String(value)]),
              ),
            );
            setLibrarySort(query.sort ?? '');
            setLibraryPage(1);
          }}
          refresh={async () => {
            await refresh();
          }}
          onError={setError}
        /></Popover>}
      </div>
      {showBulkEditing && bulkIds.length > 0 && (
        <button
          className="library-bulk-action"
          onClick={async () => {
            try {
              await persist();
              setBulkOpen(true);
            } catch (error: any) {
              setError(error.message);
            }
          }}
        >
          批量编辑（{bulkIds.length}）
        </button>
      )}
      <div className={'entry-list' + (showBulkEditing ? '' : ' without-selection')} aria-busy={libraryLoading}>
        {libraryLoading && (
          <p className="library-status" role="status">
            正在查找内容…
          </p>
        )}
        {!libraryLoading && !items.length && (
          <div className="library-empty" role="status"><p>
            {hasFilters
              ? '没有符合筛选条件的内容。'
              : '还没有内容，可以新建第一篇。'}
          </p>{hasFilters ? <button onClick={() => { setFilter(''); setStatus('all'); setVisibility('all'); setLibraryType(''); setFieldFilters({}); setLibraryPage(1); }}>清除筛选</button> : <button className="primary" onClick={newEntry}>新建内容</button>}</div>
        )}
        {items.length > 0 && <ContentEntries model={model} selectable={showBulkEditing} />}
      </div>
        <nav className="library-pagination" aria-label="内容列表分页"><span>共 {library.total} 项</span>
          {library.pages > 1 && <div className="pagination-buttons">
          <button disabled={libraryPage <= 1} onClick={() => setLibraryPage((page) => page - 1)}>
            上一页
          </button>
          <span>
            {libraryPage} / {library.pages}
          </span>
          <button
            disabled={libraryPage >= library.pages}
            onClick={() => setLibraryPage((page) => page + 1)}
          >
            下一页
          </button></div>}
        </nav>
    </section>
  );
}
