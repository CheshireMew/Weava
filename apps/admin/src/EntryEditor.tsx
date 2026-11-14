import {Popover} from './Popover.tsx';
import {EntrySettings} from './EntrySettings.tsx';
import {EntryStatus} from './EntryStatus.tsx';
import {EntryRecovery} from './EntryRecovery.tsx';
import {EntryOptionsBar} from './EntryOptionsBar.tsx';
import {EntryUrlField} from './EntryUrlField.tsx';
import {Dialog} from './Dialog.tsx';
import {Suspense,useState,useLayoutEffect,useRef} from 'react';
import {retryableLazy as lazy} from './ErrorBoundary.tsx';

import {FileText,ArrowLeft,Plus,Loader2,Settings2,ChevronDown,X} from 'lucide-react';


import {useSelectors} from './Selectors.tsx';

import {Fields} from './Fields.tsx';

import type {EntryEditorModel} from './content-models.ts';
import {LoadingState} from './LoadingState.tsx';
import {entryFieldSection, focusEntryField} from './entry-field-focus.ts';

const Editor = lazy(() => import('./Editor.tsx').then((m) => ({ default: m.Editor })));

const ImportedContentEditor = lazy(() => import('./ImportedContentEditor.tsx').then(module => ({ default: module.ImportedContentEditor })));

function focusBodyStart(root: HTMLElement | null) {
  const body = root?.querySelector('[data-field-path="document"], [data-field-path="blocks"]');
  let target = body?.querySelector<HTMLElement>('[contenteditable="true"], textarea, iframe');
  if (target instanceof HTMLIFrameElement) target = target.contentDocument?.querySelector<HTMLElement>('[contenteditable="true"]') ?? undefined;
  if (!target) return;
  target.focus();
  if (target instanceof HTMLTextAreaElement) target.setSelectionRange(0, 0);
  else {
    const range = target.ownerDocument.createRange();
    range.selectNodeContents(target.firstChild ?? target); range.collapse(true);
    const selection = target.ownerDocument.getSelection();
    selection?.removeAllRanges(); selection?.addRange(range);
  }
}

export function EntryEditor({ model }: {
  model: EntryEditorModel;
}) {
  const {record,dirty,saving,editorEpoch,contentCheck,persist,update,clear,state,busy,setError,newEntry,publish}=model;
  const selectors = useSelectors();
  const article = record?.value.kind === 'content';
  const [settingsOpen, setSettingsOpen] = useState(false);
  useLayoutEffect(()=>{
    if(contentCheck?.id===record?.id&&contentCheck?.valid===false)setSettingsOpen(true);
  },[contentCheck,record?.id]);
  const [settingsSection, setSettingsSection] = useState('information');
  const [focusRequest, setFocusRequest] = useState<{path: string} | null>(null);
  const editorRoot = useRef<HTMLElement>(null);
  const navigateToField = (path: string) => {
    const section = entryFieldSection(path, article);
    if (!section) return;
    setSettingsOpen(section !== 'writing');
    if (section !== 'writing') setSettingsSection(section);
    setFocusRequest({path});
  };
  useLayoutEffect(() => {
    if (focusRequest && editorRoot.current) return focusEntryField(editorRoot.current, focusRequest.path);
  }, [focusRequest]);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!settingsOpen || article) return;
    const settings = document.getElementById('entry-settings');
    if (settings && settings.parentElement!.getBoundingClientRect().width <= 800)
      settings.scrollIntoView({ block: 'start' });
  }, [settingsOpen, record?.id]);
  const publication=model.publication;
  const titleInput = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = titleInput.current;
    if (!input) return;
    const resize = () => { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; };
    resize();
    let width = input.parentElement!.getBoundingClientRect().width, frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry.contentRect.width;
      if (nextWidth === width) return;
      width = nextWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    });
    observer.observe(input.parentElement!);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [record?.id, record?.value.title]);
  const saveStatus = record && (record.revision > 0 || dirty || saving) ? <span className={'save-status' + (dirty ? ' unsaved' : '')} role="status">
    {saving ? <Loader2 size={12} className="spin" /> : <span className="save-status-dot" aria-hidden="true" />}{' '}
    {dirty && model.autoSave?.phase === 'offline' ? '离线，有未同步修改' : dirty && model.autoSave?.phase === 'retrying' ? '连接中断，等待重试' : saving ? '正在保存' : dirty ? '有未保存修改' : '已保存'}
  </span> : null;
  return (
    <section ref={editorRoot} className={'editing-area' + (article ? ' article-editor' : ' website-page-editor')} aria-label="内容编辑">
      {!record ? (
        <div className="empty-state">
          <div className="empty-mark" aria-hidden="true">
            <FileText size={36} strokeWidth={1.25} />
          </div>
          <h2>从一个想法开始</h2>
          <p>选择一篇内容继续编辑，或写下新的想法。</p>
          <button className="primary" onClick={()=>void newEntry()}>
            <Plus size={16} />
            新建内容
          </button>
        </div>
      ) : (
        <>
          <div className="editor-chrome"><div className="editor-bar">
            <button
              className="editor-back"
              aria-label="返回内容列表"
              title="返回内容列表"
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
              <span>返回列表</span>
            </button>
            {article ? <div className="editor-save-slot">{saveStatus}</div> : saveStatus}
            {article && <EntryOptionsBar model={model.settings} placement="toolbar" onMore={() => setSettingsOpen(true)} />}
            <div className="editor-actions">
              {!article && <div className="editor-tools">
                <button className="editor-plain editor-settings-toggle" aria-label="内容设置" aria-expanded={settingsOpen} aria-controls="entry-settings" aria-haspopup="dialog" onClick={() => setSettingsOpen(open => !open)}><Settings2 size={18} /><span>设置</span></button>
                <Popover label="更多编辑操作" menu className="editor-menu-popover" trigger={<>更多<ChevronDown size={14} aria-hidden="true" /></>}>
                  <div className="action-menu-items">
                    <button type="button" role="menuitem" className="editor-plain" onClick={async () => {
                      try {
                        await model.openHistory();
                      } catch (error: any) {
                        setError(error.message);
                      }
                    }}>历史版本</button>
                  </div>
                </Popover>
              </div>}
              <button className="editor-preview" onClick={async () => {
                try {
                  await model.openPreview();
                } catch (error: any) { setError(error.message); }
              }}>预览</button>
              <button
                className="primary async-action"
                disabled={busy || saving}
                onClick={() => publish().catch((error) => setError(error.message))}
              >
                {model.publicationPhase==='running'?'正在发布…':busy ? '准备发布…' : '发布'}
              </button>
            </div>
          </div>
          {article && <div className="editor-toolbar-slot" ref={setToolbarTarget} />}
          </div>
          <EntryRecovery model={model.recovery} />

          <div
            className={
              'editor-grid' + (settingsOpen ? ' settings-open' : '')
            }
          >
            <div className="writing">
              {article && record.value.cover && <figure className="article-cover"><img src={record.value.cover} alt="文章封面" /></figure>}
              <div className="entry-title-row">
                <textarea
                  ref={titleInput}
                  rows={1}
                  className="title-input"
                  data-field-path="title"
                  aria-label="内容标题"
                  value={record.value.title}
                  placeholder="未命名内容"
                  onChange={(e) => update({ title: e.target.value })}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
                    event.preventDefault();
                    focusBodyStart(editorRoot.current);
                  }}
                />
                {!article && publication && <EntryStatus row={{ ...publication, hasChanges: publication.hasChanges || dirty }} />}
              </div>
              {article && <>
                <EntryUrlField key={'url:' + record.id} value={record.value} onChange={update} />
                <EntryOptionsBar key={'metadata:' + record.id} model={model.settings} placement="metadata" />
              </>}
              <div data-field-path={record.value.blocks.length > 0 ? 'blocks' : 'document'} tabIndex={-1}>{record.value.blocks.length > 0 ? (
                <Suspense fallback={<LoadingState label="打开正文" />}><ImportedContentEditor key={record.id + ':' + editorEpoch} value={record.value.blocks} onChange={blocks => update({ blocks })} catalog={state} onError={setError} /></Suspense>
              ) : (
                <Suspense fallback={<LoadingState label="载入编辑器" />}>
                  <Editor
                    entryId={record.id}
                    toolbarTarget={article ? toolbarTarget : undefined}
                    key={record.id + ':' + editorEpoch}
                    value={record.value.document}
                    onChange={(document) => update({ document })}
                    onMedia={() => selectors.media()}
                    onError={setError}
                  />
                </Suspense>
              )}
              </div>
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
            {settingsOpen && (article ? <Dialog label="文章设置" className="modal article-options-dialog" onClose={() => setSettingsOpen(false)}><div className="article-options-heading"><h2>文章设置</h2><button type="button" aria-label="关闭文章设置" onClick={() => setSettingsOpen(false)}><X size={18} /></button></div><EntrySettings model={model.settings} mode="more" onFocusField={navigateToField} selectedSection={settingsSection} onSelectSection={setSettingsSection} /></Dialog> : <Dialog label="内容设置" className="article-settings-dialog" onClose={() => setSettingsOpen(false)}><EntrySettings model={model.settings} onFocusField={navigateToField} onClose={() => {
              setSettingsOpen(false);
              document.querySelector<HTMLButtonElement>('[aria-controls="entry-settings"]')?.focus();
            }} /></Dialog>)}
          </div>
        </>
      )}
    </section>
  );
}
