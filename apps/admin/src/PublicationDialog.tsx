import { useEffect, useState } from 'react';
import { FileText, Monitor, Smartphone } from 'lucide-react';
import { Dialog } from './Dialog.tsx';
import { PreviewFrame } from './PreviewFrame.tsx';
import type { PublicationController } from './usePublication.ts';
import {awaitTask} from './background-tasks.ts';

export function PublicationDialog({ model, error, onPublished }: {
  model: PublicationController;
  error: string;
  onPublished: () => Promise<void>;
}) {
  const { publication, setPublication, busy, task } = model;
  const [selectedId, setSelectedId] = useState('');
  const [narrow, setNarrow] = useState(false);
  useEffect(() => { setSelectedId(''); setNarrow(false); }, [publication]);
  if (!publication) return null;
  const selected = publication.entries.find(entry => entry.id === selectedId) ?? publication.entries[0];
  const previewQuery = new URLSearchParams({
    ...(selected?.revision ? { revision: String(selected.revision) } : {}),
    ...(publication.options.candidateId ? { candidate: publication.options.candidateId } : {}),
  });
  const otherChanges = [
    publication.settingsChanged && '网站设置',
    publication.layoutsChanged && '页面模板与共享区域',
    publication.routesChanged && '网址别名',
    publication.termsChanged && '分类与标签',
  ].filter(Boolean);
  const changed = !!(otherChanges.length || publication.entries.length || publication.removed.length);
  return <Dialog label="发布变更" className={'modal publication-dialog' + (selected ? ' with-preview' : '')} onClose={() => setPublication(null)} dismissible={!busy}>
    <div className="modal-title">
      <h2>确认发布</h2>
      <button disabled={busy} onClick={() => setPublication(null)}>关闭</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="publication-review-body">
      <div className="publication-review-content">
        <div className="publication-review-entries" role="group" aria-label="待发布内容">
          {publication.entries.map(entry => <button type="button" key={entry.id} className="publication-review-card" aria-label={'预览：' + entry.title} aria-pressed={selected?.id === entry.id} onClick={() => setSelectedId(entry.id)}>
            <span className={'publication-review-cover' + (entry.cover ? '' : ' no-cover')}>
              {entry.cover ? <img src={entry.cover} alt={entry.title + '的封面'} /> : <FileText size={36} strokeWidth={1.3} aria-hidden="true" />}
            </span>
            <span className="publication-review-action">{entry.action === 'add' ? '新增' : '更新'}{entry.visibility === 'private' ? ' · 私密' : ''}</span>
            <strong>{entry.title}</strong>
            {entry.author && <span className="publication-review-author">{entry.author}</span>}
            {entry.description && <span className="publication-review-description">{entry.description}</span>}
            <span className="publication-review-path">{entry.path}</span>
          </button>)}
        </div>
        {otherChanges.length > 0 && <section className="publication-other-changes"><h3>同步更新</h3>{otherChanges.map(label => <p key={String(label)}>{label}</p>)}</section>}
        {publication.removed.length > 0 && <section className="publication-other-changes"><h3>撤下内容</h3>{publication.removed.map(entry => <p key={entry.id}>{entry.title}<small>{entry.path}</small></p>)}</section>}
        {!changed && <p>没有需要发布的修改。</p>}
      </div>
      {selected && <section className="publication-page-preview" aria-label="页面预览">
        <div className="publication-preview-toolbar"><h3>页面预览</h3><div role="group" aria-label="预览宽度">
          <button type="button" aria-label="宽屏预览" aria-pressed={!narrow} onClick={() => setNarrow(false)}><Monitor size={16} /></button>
          <button type="button" aria-label="窄屏预览" aria-pressed={narrow} onClick={() => setNarrow(true)}><Smartphone size={16} /></button>
        </div></div>
        <div className={'publication-preview-stage' + (narrow ? ' is-narrow' : '')}>
          <PreviewFrame key={selected.id + ':' + selected.revision} title={'发布预览：' + selected.title} src={'/__preview/' + encodeURIComponent(selected.id) + '?' + previewQuery} style={{ width: narrow ? 390 : '100%' }} />
        </div>
      </section>}
    </div>
    <div className="publication-review-footer">
      <button disabled={busy} onClick={() => setPublication(null)}>返回编辑</button>
      <button className="primary async-action" disabled={busy || !changed} onClick={async () => {
        const result = await model.submit('publish', publication.options);
        if (result&&!['failed','cancelled'].includes(result.status)) { setPublication(null); void awaitTask(result.id).then(onPublished).catch(()=>{}); }
      }}>{busy ? '正在发布…' : '确认发布'}</button>
    </div>
  </Dialog>;
}
