import {Popover} from './Popover.tsx';
import {Plus,Search} from 'lucide-react';
import {isNoteType} from '@weava/contracts';

import {SavedViewControls} from './AuthoringControls.tsx';
import {ContentEntries} from './ContentEntries.tsx';
import {LoadingState} from './LoadingState.tsx';
import {LibraryFilters} from './LibraryFilters.tsx';

import type {ContentLibraryModel} from './content-models.ts';

export function ContentLibrary({ model, showSavedViews = false }: {
  model: ContentLibraryModel;
  showSavedViews?: boolean;
}) {
  const {
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
    libraryPage,
    setLibraryPage,
    library,
    libraryType,
    setLibraryType,
    librarySort,
    setLibrarySort,
    fieldFilters,
    setFieldFilters,
    items,
    newEntry,
  } = model;
  const notes=tab==='notes';
  const types=state.types.filter(row=>notes?isNoteType(row.value):!isNoteType(row.value));
  const selectedType=types.find(row=>row.id===libraryType);
  const label=notes?'笔记':selectedType?.value.label??(types.length>1?'内容':types[0]?.value.label??'文章');
  const createLabel=notes?'写笔记':'新建'+(selectedType?.value.label??(types.length===1?types[0].value.label:types.length>1?'内容':'文章'));
  const hasFilters = !!filter || visibility !== 'all' || !!libraryType || Object.values(fieldFilters).some(Boolean);
  const sortControl = <select aria-label="内容排序" value={librarySort || state.types.find((row: any) => row.id === libraryType)?.value.admin?.sort || '-updatedAt'} onChange={event => { setLibrarySort(event.target.value); setLibraryPage(1); }}>
    {Object.entries({ title: '标题升序', '-title': '标题降序', '-updatedAt': '最近修改', '-publishedAt': '最近发布', oldest: '最早发布' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
  </select>;

  return (
    <section className="library" aria-label="内容列表" tabIndex={-1}>
      <div className="library-heading">
      <div className="library-header">
        <div className="library-title">
          <h1>{label}</h1>
        </div>
      </div>
      <div className="library-overview">
        <div className="library-status-tabs" role="group" aria-label="内容状态">
          {Object.entries({ published: '已发布', scheduled: '已排期', draft: '草稿' }).map(([key, label]) => <button key={key} aria-pressed={status === key} onClick={() => { setStatus(key); setLibraryPage(1); }}>{label}</button>)}
        </div>
        {!notes&&!selectedType&&types.length>1?<div className="library-create library-create-picker"><Popover label={createLabel} menu className="library-create-menu" trigger={<><Plus size={18}/>{createLabel}</>}>
          {types.map(type=><button type="button" role="menuitem" key={type.id} onClick={()=>void newEntry(type.id)}>{'新建'+type.value.label}</button>)}
        </Popover></div>:<button className="primary library-create" aria-label={createLabel} title={createLabel} onClick={()=>void newEntry(selectedType?.id)}>
          <Plus size={18} />{createLabel}
        </button>}
      </div>
      </div>
      <div className="library-tools">
        <div className="library-search">
          <Search size={15} />
          <input
            aria-label="搜索内容"
            type="search"
            placeholder="搜索标题、摘要或正文"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="library-filters">
          <LibraryFilters model={model}/>
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
            setStatus(['draft','archived'].includes(query.status??'') ? 'draft' : 'published');
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
      <div className="entry-list without-selection" aria-busy={libraryLoading}>
        {libraryLoading && (
          <LoadingState label="读取内容列表" />
        )}
        {!libraryLoading && !items.length && (
          <div className="library-empty" role="status"><p>
            {hasFilters
              ? '没有符合筛选条件的内容。'
              : status==='scheduled' ? '没有已排期的文章。' : status==='draft' ? '还没有草稿。' : '还没有已发布的文章。'}
          </p></div>
        )}
        {items.length > 0 && <ContentEntries model={model} selectable={false} showType={!libraryType && types.length > 1} />}
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
