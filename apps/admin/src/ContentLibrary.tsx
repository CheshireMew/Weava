import React from 'react';

import { Plus, Search } from 'lucide-react';
import { type FieldDefinition } from '@weava/contracts';

import { SavedViewControls } from './AuthoringControls.tsx';

import type { ContentWorkspace } from './useContentWorkspace.ts';

export function ContentLibrary({ model }: { model: ContentWorkspace }) {
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

  return (
    <section className="library" aria-label="内容列表" tabIndex={-1}>
      <div className="library-header">
        <div>
          <h1>{tab === 'pages' ? '页面' : '内容'}</h1>
          <span>{library.total} 项</span>
        </div>
        <button className="icon-primary" aria-label="新建" onClick={newEntry}>
          <Plus size={19} />
        </button>
      </div>
      <div className="library-search">
        <Search size={15} />
        <input
          aria-label="搜索内容"
          placeholder="搜索标题或摘要"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <select aria-label="内容状态" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="all">全部状态</option>
        <option value="published">已发布</option>
        <option value="changed">有未发布修改</option>
        <option value="draft">草稿</option>
        <option value="archived">已归档</option>
      </select>
      <select
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
      <select
        aria-label="内容排序"
        value={
          librarySort ||
          state.types.find((row: any) => row.id === libraryType)?.value.admin?.sort ||
          'title'
        }
        onChange={(event) => {
          setLibrarySort(event.target.value);
          setLibraryPage(1);
        }}
      >
        {Object.entries({
          title: '标题升序',
          '-title': '标题降序',
          '-updatedAt': '最近修改',
          '-publishedAt': '最近发布',
          oldest: '最早发布',
        }).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <SavedViewControls
        key={tab}
        views={state.contentViews ?? []}
        query={{
          kind: tab === 'pages' ? 'page' : 'content',
          type: libraryType || undefined,
          query: filter || undefined,
          status: status as any,
          visibility: visibility as any,
          fields: fieldFilters,
          sort: (librarySort ||
            state.types.find((row: any) => row.id === libraryType)?.value.admin?.sort ||
            'title') as any,
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
      />
      {bulkIds.length > 0 && (
        <button
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
      <div className="entry-list" aria-busy={libraryLoading}>
        {libraryLoading && (
          <p className="library-status" role="status">
            正在查找内容…
          </p>
        )}
        {!libraryLoading && !items.length && (
          <p className="library-status" role="status">
            {filter || status !== 'all' || visibility !== 'all' || libraryType
              ? '没有符合筛选条件的内容。'
              : '还没有内容，可以新建第一篇。'}
          </p>
        )}
        {items.map((r: any) => (
          <React.Fragment key={r.id}>
            <label className="entry-selection">
              <input
                type="checkbox"
                disabled={libraryLoading || filter !== searchTerm}
                aria-label={'批量选择 ' + r.value.title}
                checked={bulkIds.includes(r.id)}
                onChange={(event) =>
                  setBulkIds((ids) =>
                    event.target.checked ? [...ids, r.id] : ids.filter((id) => id !== r.id),
                  )
                }
              />
            </label>
            <button
              key={r.id}
              aria-current={record?.id === r.id ? 'true' : undefined}
              className={record?.id === r.id ? 'selected' : ''}
              onClick={() => select(r.id)}
            >
              <div>
                {(
                  state.types.find((type: any) => type.id === r.value.type)?.value.admin
                    ?.columns ?? ['status']
                ).includes('status') && (
                  <>
                    <span className={'status-dot ' + (r.published ? 'published' : '')} />
                    <span>
                      {r.published
                        ? r.hasChanges
                          ? '已修改'
                          : '已发布'
                        : r.value.status === 'archived'
                          ? '已归档'
                          : '草稿'}
                    </span>
                  </>
                )}
                {!state.types.find((type: any) => type.id === r.value.type)?.value.admin
                  ?.columns && (
                  <time>
                    {new Date(r.updatedAt).toLocaleDateString('zh-CN', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </time>
                )}
              </div>
              <h2>{r.value.title}</h2>
              {state.types
                .find((type: any) => type.id === r.value.type)
                ?.value.admin?.columns?.filter((key: string) => !['title', 'status'].includes(key))
                .map((key: string) => {
                  const field = state.types
                    .find((type: any) => type.id === r.value.type)
                    ?.value.fields.find((field: any) => field.key === key);
                  const value =
                    key === 'updatedAt'
                      ? r.updatedAt
                      : key === 'publishedAt'
                        ? r.value.publishedAt
                        : r.value.fields?.[key];
                  return (
                    <span className="entry-custom-column" key={key}>
                      {field?.label ?? (key === 'updatedAt' ? '修改时间' : '发布时间')}：
                      {Array.isArray(value)
                        ? value.length + ' 项'
                        : typeof value === 'boolean'
                          ? value
                            ? '是'
                            : '否'
                          : typeof value === 'object'
                            ? '字段组'
                            : String(value ?? '—')}
                    </span>
                  );
                })}
              {r.value.visibility === 'private' && <span>私密</span>}
              <p>{r.value.description || r.value.path}</p>
            </button>
          </React.Fragment>
        ))}
      </div>
      {library.pages > 1 && (
        <nav className="library-pagination" aria-label="内容列表分页">
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
          </button>
        </nav>
      )}
    </section>
  );
}
