import {createPortal} from 'react-dom';
import type {ReactNode} from 'react';
import {FileCode2, FileText, Bold, Italic, Quote, List, ListOrdered, Code, ImagePlus, Link, Table, Undo2, Redo2, Video} from 'lucide-react';

export type FormatAction = 'undo' | 'redo' | 'bold' | 'italic' | 'quote' | 'bullet' | 'ordered' | 'code' | 'link' | 'video' | 'table' | 'media';

export function ToolbarOutlet({target, children}: {target?: HTMLElement | null; children: ReactNode}) {
  return target ? createPortal(children, target) : children;
}

/** Both editing modes use the same controls and geometry. */
export function FormattingToolbar({mode, onMode, onAction, onBlock, onCaptureBlock, blockType = 'paragraph', codeLanguage = 'text', onLanguage, onCaptureLanguage, compact = false, uploading = false, linkActive = false, onEdit = () => {}}: {
  mode: 'visual' | 'source'; onMode: () => void; onAction: (action: FormatAction) => void;
  onBlock: (type: string) => void; onCaptureBlock?: () => void; blockType?: string;
  codeLanguage?: string; onLanguage: (language: string) => void; onCaptureLanguage?: () => void;
  compact?: boolean; uploading?: boolean; linkActive?: boolean; onEdit?: () => void;
}) {
  const button = (label: string, icon: ReactNode, action: FormatAction) => <button type="button" title={label} aria-label={label} aria-pressed={action === 'link' ? linkActive : undefined} onMouseDown={event => event.preventDefault()} onClick={() => onAction(action)}>{icon}</button>;
  return <div className={'format-toolbar' + (mode === 'source' ? ' source-toolbar' : '')} role="toolbar" aria-label="正文格式"
    onClickCapture={event => {if (!(event.target as Element).closest('.editor-mode-toggle')) onEdit();}} onChangeCapture={onEdit}>
    <button type="button" className="editor-mode-toggle" disabled={uploading} title={mode === 'visual' ? '切换为 Markdown' : '切换为富文本'} aria-label={mode === 'visual' ? '切换为 Markdown' : '切换为富文本'} onMouseDown={event => event.preventDefault()} onClick={onMode}>
      {mode === 'visual' ? <FileCode2 size={18} aria-hidden="true"/> : <FileText size={18} aria-hidden="true"/>}
    </button>
    <span className="toolbar-divider" aria-hidden="true"/>
    {button('撤销', <Undo2 size={16}/>, 'undo')}{button('重做', <Redo2 size={16}/>, 'redo')}
    <span className="toolbar-divider" aria-hidden="true"/>
    {!compact && <select aria-label="段落格式" value={blockType} onMouseDown={onCaptureBlock} onChange={event => onBlock(event.target.value)}>
      <option value="paragraph">正文</option><option value="h2">标题</option><option value="quote">引用</option><option value="code">代码</option>
    </select>}
    <span className="toolbar-divider" aria-hidden="true"/>
    {button('加粗', <Bold size={16}/>, 'bold')}{button('斜体', <Italic size={16}/>, 'italic')}
    <span className="toolbar-divider" aria-hidden="true"/>
    {!compact && button('引用', <Quote size={16}/>, 'quote')}
    {button('无序列表', <List size={17}/>, 'bullet')}
    {!compact && button('有序列表', <ListOrdered size={17}/>, 'ordered')}
    {!compact && button('代码', <Code size={17}/>, 'code')}
    {blockType === 'code' && <select aria-label="代码语言" value={codeLanguage} onMouseDown={onCaptureLanguage} onChange={event => onLanguage(event.target.value)}>
      {['text','typescript','javascript','python','json','html','css','bash','sql','yaml'].map(language => <option key={language}>{language}</option>)}
    </select>}
    {button('链接', <Link size={16}/>, 'link')}
    {!compact && button('插入视频', <Video size={17}/>, 'video')}
    {!compact && button('表格', <Table size={16}/>, 'table')}
    {button('插入媒体', <ImagePlus size={17}/>, 'media')}
  </div>;
}
