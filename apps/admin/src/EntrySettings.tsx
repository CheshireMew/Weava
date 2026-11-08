import {Upload} from 'lucide-react';
import {type Entry} from '@weava/contracts';

import {TermPicker} from './TermPicker.tsx';
import {useSelectors} from './Selectors.tsx';
import {PanelSections} from './PanelSections.tsx';
import {EntrySchedule} from './EntrySchedule.tsx';
import {EntryMoreActions} from './EntryMoreActions.tsx';

import {EditorialFields} from './EditorialFields.tsx';
import {SeoFields} from './SeoFields.tsx';
import type {EntrySettingsModel} from './content-models.ts';
import {entryFieldSection} from './entry-field-focus.ts';

export function EntrySettings({
  model,
  onClose,
  mode = 'panel',
  onFocusField,
  selectedSection,
  onSelectSection,
}: {
  onClose?: () => void;
  mode?: 'panel' | 'more';
  model:EntrySettingsModel;
  onFocusField?: (path: string) => void;
  selectedSection?: string;
  onSelectSection?: (id: string) => void;
}) {
  const {
    record,
    dirty,
    saving,
    contentCheck,
    update,
    state,
  } = model;
  const selectors = useSelectors();
  if (!record) return null;
  const information = <>
        <label data-field-path="path">
          内容网址
          <input value={record.value.path} onChange={(e) => update({ path: e.target.value })} />
        </label>
    {record.value.kind === 'content' && <>
            <label data-field-path="author">
              作者
              <input
                value={record.value.author}
                onChange={(e) => update({ author: e.target.value })}
              />
            </label>
    </>}
  </>;
  const review = <>
        {record.value.compatibility?.wordpress?.unresolved?.length > 0 && (
          <section className="import-review" data-field-path="compatibility">
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
  </>;
  return <aside className={'entry-settings' + (mode === 'more' ? ' entry-options-form' : '')} id="entry-settings" aria-label="内容设置">
    {mode !== 'more' && <div className="entry-settings-heading"><h2>内容设置</h2>{onClose && <button type="button" onClick={onClose}>收起</button>}</div>}
        {contentCheck?.id === record.id && (
          <div className="content-check" role="status">
            {contentCheck.valid ? (
              '检查通过，尚未发布。'
            ) : (
              <ul>
                {contentCheck.errors.map((error: any, index: number) => (
                  <li key={index} data-error-path={error.path}>
                    {onFocusField && entryFieldSection(error.path) ? <button
                      type="button"
                      onClick={() => onFocusField(error.path)}
                    >
                      {error.message}
                    </button> : error.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

    {mode === 'more' ? <PanelSections label="文章设置分类" selectedSection={selectedSection} onSelectSection={onSelectSection} sections={[
      { id: 'information', label: '文章信息', content: information },
      { id: 'presentation', label: '摘要与展示', content: <EditorialFields value={record.value} onChange={update} entries={state.entries ?? []} section="display" /> },
      { id: 'sharing', label: '搜索与分享', content: <SeoFields value={record.value} onChange={update} canVerify={!dirty && !saving} section="sharing" expanded /> },
      { id: 'advanced', label: '更多操作', content: <>{review}<EntryMoreActions model={model.moreActions} /></> },
    ]} /> : <>
      {review}
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

      {information}
      {record.value.kind === 'content' && <>
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
      </>}
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
            checked={record.value.allowComments !== false}
            onChange={(event) => update({ allowComments: event.target.checked })}
          />
          允许新评论
        </label>

      <section><h3>定时发布</h3><EntrySchedule model={model.schedule} /></section>
      <EditorialFields value={record.value} onChange={update} entries={state.entries ?? []} />

      <SeoFields value={record.value} onChange={update} canVerify={!dirty && !saving} />
      <section><h3>更多操作</h3><EntryMoreActions model={model.moreActions} /></section>
    </>}
  </aside>;
}
