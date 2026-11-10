import {Popover} from './Popover.tsx';
import {Plus,Search,SlidersHorizontal,X} from 'lucide-react';
import {isNoteType,type FieldDefinition} from '@weava/contracts';
import {useState} from 'react';

import {SavedViewControls} from './AuthoringControls.tsx';
import {ContentEntries} from './ContentEntries.tsx';
import {LoadingState} from './LoadingState.tsx';
import {Trash} from './Trash.tsx';

import type {ContentLibraryModel} from './content-models.ts';

export function ContentLibrary({ model, showBulkEditing = true, showSavedViews = false }: {
  model: ContentLibraryModel;
  showBulkEditing?: boolean;
  showSavedViews?: boolean;
}) {
  const {
    record,
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
    openBulk,
    fieldFilters,
    setFieldFilters,
    items,
    newEntry,
  } = model;
  const [selectionMode, setSelectionMode] = useState(false);
  const selecting = showBulkEditing && selectionMode;
  const notes=tab==='notes';
  const types=state.types.filter(row=>notes?isNoteType(row.value):!isNoteType(row.value));
  const selectedType=types.find(row=>row.id===libraryType);
  const label=notes?'笔记':selectedType?.value.label??(types.length>1?'内容':types[0]?.value.label??'文章');
  const createLabel=notes?'写笔记':'新建'+(selectedType?.value.label??(types.length===1?types[0].value.label:types.length>1?'内容':'文章'));
  const hasFilters = !!filter || status !== 'all' || visibility !== 'all' || !!libraryType || Object.values(fieldFilters).some(Boolean);
  const clearFilters=()=>{setFilter('');setStatus('all');setVisibility('all');setLibraryType('');setFieldFilters({});setLibraryPage(1);};
  const extraFilters=[
    ...(visibility!=='all'?[{key:'visibility',label:visibility==='private'?'私密':'公开',clear:()=>setVisibility('all')}]:[]),
    ...(libraryType?[{key:'type',label:selectedType?.value.label??libraryType,clear:()=>{setLibraryType('');setFieldFilters({});}}]:[]),
    ...Object.entries(fieldFilters).filter(([,value])=>!!value).map(([key,value])=>({key:'field.'+key,label:(selectedType?.value.fields.find(field=>field.key===key)?.label??key)+'：'+value,clear:()=>setFieldFilters(previous=>({...previous,[key]:''}))})),
  ];
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
          {Object.entries({ all: '全部', published: '已发布', draft: '草稿', changed: '有未发布修改', scheduled:'已安排发布', 'schedule-failed':'定时发布失败', archived: '已归档' }).map(([key, label]) => <button key={key} aria-pressed={status === key} onClick={() => { setStatus(key); setLibraryPage(1); }}>{label}</button>)}
        </div>
        {!notes&&!selectedType&&types.length>1?<div className="library-create library-create-picker"><Popover label={createLabel} menu className="library-create-menu" trigger={<><Plus size={18}/>{createLabel}</>}>
          {types.map(type=><button type="button" role="menuitem" key={type.id} onClick={()=>void newEntry(type.id)}>{'新建'+type.value.label}</button>)}
        </Popover></div>:<button className="primary library-create" aria-label={createLabel} title={createLabel} onClick={()=>void newEntry(selectedType?.id)}>
          <Plus size={18} />{createLabel}
        </button>}
      </div>
      </div>
      <div className="library-tools">
        <Trash/>
        <div className="library-search">
          <Search size={15} />
          <input
            aria-label="搜索内容"
            placeholder="搜索标题、摘要或正文"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="library-filters">
          <Popover label="筛选内容" className="library-filter-popover" trigger={<><SlidersHorizontal size={17} aria-hidden="true" />筛选</>}><div className="library-secondary-filters">
          <select
            aria-label="内容可见性"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
            <option value="all">全部可见性</option>
            <option value="public">公开</option>
            <option value="private">私密</option>
          </select>
          {['content','notes'].includes(tab) && (
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
              {state.types.filter((row:any)=>notes?isNoteType(row.value):!isNoteType(row.value)).map((type: any) => (
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
                            {field.type === 'boolean' ? (option === 'true' ? '是' : '否') : field.optionLabels?.[option] ?? option}
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
        {showBulkEditing && <button type="button" className="library-selection-toggle" aria-pressed={selecting} disabled={model.busy} onClick={() => {
          setSelectionMode(!selecting);
          setBulkIds([]);
        }}>{selecting ? '取消选择' : '批量选择'}</button>}
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
      {hasFilters&&<div className="library-active-filters" role="group" aria-label="已生效的筛选">
        {extraFilters.map(item=><button type="button" key={item.key} onClick={item.clear} aria-label={'移除筛选：'+item.label}>{item.label}<X size={13} aria-hidden="true"/></button>)}
        <button type="button" className="library-clear-filters" onClick={clearFilters}>清除筛选</button>
      </div>}
      {selecting && bulkIds.length > 0 && (
        <button
          className="library-bulk-action"
          disabled={model.busy || libraryLoading || filter !== searchTerm}
          onClick={async () => {
            try {
              await openBulk();
            } catch (error: any) {
              setError(error.message);
            }
          }}
        >
          批量编辑（{bulkIds.length}）
        </button>
      )}
      <div className={'entry-list' + (selecting ? '' : ' without-selection')} aria-busy={libraryLoading}>
        {libraryLoading && (
          <LoadingState label="读取内容列表" />
        )}
        {!libraryLoading && !items.length && (
          <div className="library-empty" role="status"><p>
            {hasFilters
              ? '没有符合筛选条件的内容。'
              : '还没有内容，可以新建第一篇。'}
          </p></div>
        )}
        {items.length > 0 && <ContentEntries model={model} selectable={selecting} showType={!libraryType && types.length > 1} />}
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
