import { EntrySettings } from './EntrySettings.tsx';
import { EntryRecovery } from './EntryRecovery.tsx';
import { lazy, Suspense } from 'react';

import { FileText, ArrowLeft, Plus, Check, Loader2, History, Eye } from 'lucide-react';

import { api } from './api.ts';
import { localDrafts } from './local-drafts.ts';

import { useSelectors } from './Selectors.tsx';

import { Fields } from './Fields.tsx';

import type { ContentWorkspace } from './useContentWorkspace.ts';

const Editor = lazy(() => import('./Editor.tsx').then((m) => ({ default: m.Editor })));

const PageDesigner = lazy(() =>
  import('./PageDesigner.tsx').then((module) => ({ default: module.PageDesigner })),
);

export function EntryEditor({ model }: { model: ContentWorkspace }) {
  const {
    record,
    dirty,
    saving,
    session,
    editorEpoch,
    setHistory,
    setPreview,
    setRestoreLocal,
    setRecoveryCopies,
    setDraftNotice,
    contentCheck,
    setContentCheck,
    persist,
    update,
    clear,
    state,
    tab,
    busy,
    setError,
    notify,
    refresh,
    newEntry,
    publish,
  } = model;
  const selectors = useSelectors();
  return (
    <section className="editing-area">
      {!record ? (
        <div className="empty-state">
          <div className="empty-mark" aria-hidden="true">
            <FileText size={44} strokeWidth={1.4} />
          </div>
          <h2>{tab === 'pages' ? '组织你的页面。' : '从一个想法开始。'}</h2>
          <p>选择现有内容，或创建新的开始。</p>
          <button className="primary" onClick={newEntry}>
            <Plus size={16} />
            新建{tab === 'pages' ? '页面' : '内容'}
          </button>
        </div>
      ) : (
        <>
          <div className="editor-bar">
            <button
              className="editor-back"
              aria-label="返回内容列表"
              onClick={async () => {
                try {
                  await persist();
                  clear();
                  requestAnimationFrame(() =>
                    document.querySelector<HTMLElement>('.library')?.focus({ preventScroll: true }),
                  );
                } catch (error: any) {
                  setError(error.message);
                }
              }}
            >
              <ArrowLeft size={16} />
              返回列表
            </button>
            <span className={'save-status' + (dirty ? ' unsaved' : '')} role="status">
              {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}{' '}
              {saving ? '正在保存' : dirty ? '有未保存修改' : '已保存'}
            </span>
            <div>
              <button
                title="历史版本"
                aria-label="历史版本"
                onClick={async () => {
                  try {
                    await persist();
                    setHistory(await api(`history?id=${record.id}`));
                  } catch (error: any) {
                    setError(error.message);
                  }
                }}
              >
                <History size={16} />
              </button>
              <button
                onClick={async () => {
                  try {
                    const row = await persist();
                    if (!row) return;
                    setPreview('/__preview/' + record.id + '?revision=' + row.revision);
                  } catch (error: any) {
                    setError(error.message);
                  }
                }}
              >
                <Eye size={16} />
                预览
              </button>
              <button
                onClick={() => {
                  try {
                    const copies = localDrafts(record.id);
                    setRecoveryCopies(copies);
                    setRestoreLocal(copies[0]?.record ?? null);
                    if (!copies.length) notify('没有本地副本。');
                  } catch (error: any) {
                    setDraftNotice(error.message);
                  }
                }}
              >
                本地副本
              </button>
              <button
                disabled={busy || saving}
                onClick={async () => {
                  try {
                    const result = await api('entry/check', { value: session.record!.value });
                    setContentCheck({ ...result, id: record.id });
                  } catch (error: any) {
                    setError(error.message);
                  }
                }}
              >
                检查
              </button>
              <button
                className="primary"
                disabled={busy || saving}
                onClick={() => publish().catch((error) => setError(error.message))}
              >
                发布
              </button>
            </div>
          </div>
          <EntryRecovery model={model} />

          <div
            className={
              'editor-grid' +
              (record.value.kind === 'page' || record.value.blocks.length > 0
                ? ' page-editing'
                : '')
            }
          >
            <div className="writing">
              <input
                className="title-input"
                aria-label="内容标题"
                value={record.value.title}
                placeholder="标题"
                onChange={(e) => update({ title: e.target.value })}
              />
              <textarea
                className="description-input"
                aria-label="内容摘要"
                rows={2}
                placeholder="用一两句话介绍这份内容…"
                value={record.value.description}
                onChange={(e) => update({ description: e.target.value })}
              />
              {record.value.kind === 'page' || record.value.blocks.length > 0 ? (
                <Suspense fallback={<p>正在载入页面编辑…</p>}>
                  <PageDesigner
                    entryId={record.id}
                    previewKey={JSON.stringify([
                      record.value.template,
                      record.value.title,
                      record.value.description,
                      record.value.fields,
                    ])}
                    value={record.value.blocks}
                    onChange={(blocks) =>
                      update({
                        blocks,
                        ...(!blocks.length
                          ? { document: { version: 1, format: 'markdown', source: '' } as const }
                          : {}),
                      })
                    }
                    save={persist}
                    onError={setError}
                    catalog={{
                      ...state,
                      allowedBlocks:
                        record.value.kind === 'content'
                          ? state.types.find((row: any) => row.id === record.value.type)?.value
                              .allowedBlocks
                          : undefined,
                    }}
                    saveSnippet={
                      record.value.kind === 'content'
                        ? async (blocks) => {
                            const label = window.prompt('组合名称');
                            if (!label?.trim()) return;
                            await api('layouts', {
                              value: {
                                id: 'snippet-' + crypto.randomUUID(),
                                label,
                                kind: 'pattern',
                                appliesTo: 'content',
                                blocks,
                              },
                              revision: null,
                            });
                            await refresh();
                            notify('所选片段已保存为组合');
                          }
                        : undefined
                    }
                  />
                </Suspense>
              ) : (
                <Suspense fallback={<p>正在载入编辑器…</p>}>
                  <Editor
                    key={record.id + ':' + editorEpoch}
                    value={record.value.document}
                    onChange={(document) => update({ document })}
                    onMedia={() => selectors.media()}
                    onError={setError}
                  />
                </Suspense>
              )}
              {record.value.kind === 'content' && (
                <Fields
                  key={record.id}
                  definitions={
                    state.types.find((t: any) => t.id === record.value.type)?.value.fields ?? []
                  }
                  layout={
                    state.types.find((t: any) => t.id === record.value.type)?.value.admin?.fields
                  }
                  errors={contentCheck?.id === record.id ? contentCheck.errors : []}
                  values={record.value.fields}
                  onChange={(fields) => update({ fields })}
                />
              )}
            </div>
            <EntrySettings model={model} />
          </div>
        </>
      )}
    </section>
  );
}
