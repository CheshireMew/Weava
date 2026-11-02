import { Upload, Archive } from 'lucide-react';
import { type Entry } from '@weava/contracts';
import { api } from './api.ts';

import { TermPicker } from './TermPicker.tsx';
import { useSelectors } from './Selectors.tsx';
import { SaveCreationTemplate } from './AuthoringControls.tsx';

import { EditorialFields } from './EditorialFields.tsx';
import { SeoFields } from './SeoFields.tsx';
import type { ContentWorkspace } from './useContentWorkspace.ts';

export function EntrySettings({
  model,
}: {
  model: Pick<
    ContentWorkspace,
    | 'record'
    | 'dirty'
    | 'saving'
    | 'session'
    | 'contentCheck'
    | 'scheduleDueAt'
    | 'setScheduleDueAt'
    | 'persist'
    | 'update'
    | 'select'
    | 'state'
    | 'busy'
    | 'setError'
    | 'notify'
    | 'refresh'
  >;
}) {
  const {
    record,
    dirty,
    saving,
    session,
    contentCheck,
    scheduleDueAt,
    setScheduleDueAt,
    persist,
    update,
    select,
    state,
    busy,
    setError,
    notify,
    refresh,
  } = model;
  const selectors = useSelectors();
  if (!record) return null;
  return (
    <>
      <aside className="entry-settings">
        <h2>发布设置</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={record.value.allowComments !== false}
            onChange={(event) => update({ allowComments: event.target.checked })}
          />
          允许新评论
        </label>
        <SaveCreationTemplate
          entry={record.value}
          onSaved={async () => {
            await refresh();
          }}
          onError={setError}
        />
        {record.value.kind === 'content' &&
          !record.value.blocks.length &&
          (!state.types.find((row: any) => row.id === record.value.type)?.value.allowedBlocks ||
            state.types
              .find((row: any) => row.id === record.value.type)
              .value.allowedBlocks.includes('richtext')) && (
            <button
              onClick={async () => {
                try {
                  update({
                    blocks: await api('entry/structure', { value: session.record!.value }),
                  });
                } catch (error: any) {
                  setError(error.message);
                }
              }}
            >
              使用区块正文
            </button>
          )}
        {record.value.blocks.length > 0 && (
          <button
            onClick={async () => {
              const label = window.prompt('组合名称');
              if (!label?.trim()) return;
              try {
                await api('layouts', {
                  value: {
                    id: 'snippet-' + crypto.randomUUID(),
                    label,
                    kind: 'pattern',
                    appliesTo: 'any',
                    blocks: record.value.blocks,
                  },
                  revision: null,
                });
                await refresh();
                notify('正文片段已保存为组合');
              } catch (error: any) {
                setError(error.message);
              }
            }}
          >
            保存正文片段
          </button>
        )}
        <EditorialFields value={record.value} onChange={update} entries={state.entries ?? []} />
        {record.value.compatibility?.wordpress?.unresolved?.length > 0 && (
          <section className="import-review">
            <h3>来源功能检查</h3>
            <ul>
              {record.value.compatibility!.wordpress.unresolved.map((reason: string) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={!!record.value.compatibility!.wordpress.reviewed}
                onChange={(event) =>
                  update({
                    compatibility: {
                      ...record.value.compatibility,
                      wordpress: {
                        ...record.value.compatibility!.wordpress,
                        reviewed: event.target.checked,
                      },
                    },
                  })
                }
              />
              我已检查并处理这些内容
            </label>
          </section>
        )}
        <label>
          页面模板
          <select
            value={record.value.template ?? ''}
            onChange={(event) => update({ template: event.target.value || undefined })}
          >
            <option value="">使用默认模板</option>
            {(state.layouts ?? [])
              .filter(
                (row: any) =>
                  row.value.kind === 'template' &&
                  ['any', record.value.kind].includes(row.value.appliesTo),
              )
              .map((row: any) => (
                <option key={row.id} value={row.id}>
                  {row.value.label}
                </option>
              ))}
          </select>
        </label>
        <label>
          定时发布
          <input
            type="datetime-local"
            aria-label="定时发布时间"
            value={scheduleDueAt}
            onChange={(event) => setScheduleDueAt(event.target.value)}
          />
        </label>
        <button
          disabled={!scheduleDueAt || busy}
          onClick={async () => {
            try {
              const row = await persist();
              if (!row) return;
              await api('schedule', {
                id: row.id,
                revision: row.revision,
                dueAt: new Date(scheduleDueAt).toISOString(),
              });
              setScheduleDueAt('');
              await refresh();
              notify('定时发布已安排');
            } catch (error: any) {
              setError(error.message);
            }
          }}
        >
          安排发布
        </button>
        {(state.schedules ?? [])
          .filter(
            (item: any) =>
              item.value.entryId === record.id &&
              ['scheduled', 'failed'].includes(item.value.status),
          )
          .map((item: any) => (
            <div className="schedule-item" key={item.id}>
              <time>{new Date(item.value.dueAt).toLocaleString()}</time>
              <p>{item.value.status === 'failed' ? item.value.error : '等待发布指定修订'}</p>
              <button
                onClick={async () => {
                  try {
                    await api('schedule/cancel', { id: item.id, revision: item.revision });
                    await refresh();
                  } catch (error: any) {
                    setError(error.message);
                  }
                }}
              >
                取消计划
              </button>
              {item.value.status === 'failed' && (
                <button
                  onClick={async () => {
                    try {
                      await api('schedule/retry', { id: item.id, revision: item.revision });
                      await refresh();
                    } catch (error: any) {
                      setError(error.message);
                    }
                  }}
                >
                  重试
                </button>
              )}
            </div>
          ))}
        <label>
          可见性
          <select
            aria-label="文章可见性"
            value={record.value.visibility ?? 'public'}
            onChange={(e) => update({ visibility: e.target.value as Entry['visibility'] })}
          >
            <option value="public">公开</option>
            <option value="private">私密（仅站主）</option>
          </select>
        </label>
        <label>
          网址
          <input value={record.value.path} onChange={(e) => update({ path: e.target.value })} />
        </label>
        {record.value.kind === 'content' && (
          <>
            <label>
              内容类型
              <select value={record.value.type} onChange={(e) => update({ type: e.target.value })}>
                {state.types.map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.value.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              作者
              <input
                value={record.value.author}
                onChange={(e) => update({ author: e.target.value })}
              />
            </label>
            <TermPicker
              label="分类"
              kind="category"
              terms={(state.terms ?? []).map((row: any) => row.value)}
              value={record.value.categories}
              selectedIds={record.value.termIds?.categories}
              onChange={(categories, ids) =>
                update({
                  categories,
                  termIds: { categories: ids, tags: record.value.termIds?.tags ?? [] },
                })
              }
            />
            <TermPicker
              label="标签"
              kind="tag"
              terms={(state.terms ?? []).map((row: any) => row.value)}
              value={record.value.tags}
              selectedIds={record.value.termIds?.tags}
              onChange={(tags, ids) =>
                update({
                  tags,
                  termIds: { tags: ids, categories: record.value.termIds?.categories ?? [] },
                })
              }
            />
          </>
        )}
        {contentCheck?.id === record.id && (
          <div className="content-check" role="status">
            {contentCheck.valid ? (
              '检查通过，尚未发布。'
            ) : (
              <ul>
                {contentCheck.errors.map((error: any, index: number) => (
                  <li key={index} data-error-path={error.path}>
                    <button
                      type="button"
                      onClick={() => {
                        const field = document.querySelector(
                          '[data-field-path="' + CSS.escape(error.path) + '"]',
                        );
                        field?.scrollIntoView({ block: 'center' });
                        (
                          field?.querySelector('input,select,textarea,button') as HTMLElement
                        )?.focus();
                      }}
                    >
                      {error.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <label>
          封面
          {record.value.cover && (
            <img className="cover-preview" src={record.value.cover} alt="内容封面" />
          )}
          <input
            value={record.value.cover}
            placeholder="图片地址"
            onChange={(e) => update({ cover: e.target.value })}
          />
        </label>
        <button
          onClick={async () => {
            const media = await selectors.media('image');
            if (media) update({ cover: media.url });
          }}
        >
          <Upload size={14} />
          选择封面
        </button>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={record.value.visibility !== 'private' && record.value.indexable}
            disabled={record.value.visibility === 'private'}
            onChange={(e) => update({ indexable: e.target.checked })}
          />
          允许搜索引擎收录
        </label>
        <SeoFields value={record.value} onChange={update} canVerify={!dirty && !saving} />
        <div className="settings-divider" />
        <button
          onClick={() => {
            const blob = new Blob(
              [
                record.value.document.format === 'markdown'
                  ? record.value.document.source
                  : JSON.stringify(record.value, null, 2),
              ],
              { type: 'text/plain' },
            );
            const url = URL.createObjectURL(blob),
              a = document.createElement('a');
            a.href = url;
            a.download =
              record.id + (record.value.document.format === 'markdown' ? '.md' : '.json');
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          导出内容
        </button>
        <button
          onClick={async () => {
            const row = await persist();
            if (!row) return;
            await api('withdraw', { id: row.id, revision: row.revision });
            await refresh();
            await select(row.id);
          }}
        >
          撤下为草稿
        </button>
        <button
          onClick={async () => {
            const row = await persist();
            if (!row) return;
            await api('withdraw', {
              id: row.id,
              revision: row.revision,
              archive: true,
            });
            await refresh();
            await select(row.id);
          }}
        >
          <Archive size={14} />
          归档
        </button>
      </aside>
    </>
  );
}
