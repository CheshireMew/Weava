import {createPortal} from 'react-dom';
import type {ReactNode} from 'react';
import {FileCode2, FileText, Bold, Italic, Link, Undo2, Redo2, ImagePlus, ChevronDown, Highlighter, Baseline, AlignLeft, AlignCenter, AlignRight, AlignJustify, Quote, Minus, Code2} from 'lucide-react';
import {Popover} from '../Popover.tsx';
import {textColors, highlightColors} from '../../../../packages/runtime-common/src/writing-format.ts';

export type FormatAction = 'undo' | 'redo' | 'bold' | 'italic' | 'strikethrough' | 'inline-code' | 'underline' | 'subscript' | 'superscript' | 'quote' | 'bullet' | 'ordered' | 'code' | 'link' | 'video' | 'table' | 'media' | 'divider' | 'button' | 'footnote' | 'details' | 'snippets' | `color:${string}` | `highlight:${string}` | `align:${string}`;
export function ToolbarOutlet({target, children}: {target?: HTMLElement | null; children: ReactNode}) {return target ? createPortal(children, target) : children;}
export function FormattingToolbar({mode, onMode, onAction, onBlock, onCaptureBlock, onCapture, blockType = 'paragraph', codeLanguage = 'text', onLanguage, onCaptureLanguage, compact = false, snippets = true, uploading = false, linkActive = false, onEdit = () => {},disabled=false}: {
  mode: 'visual' | 'source'; onMode: () => void; onAction: (action: FormatAction) => void;
  onBlock: (type: string) => void; onCaptureBlock?: () => void; onCapture?: () => void; blockType?: string;
  codeLanguage?: string; onLanguage: (language: string) => void; onCaptureLanguage?: () => void;
  compact?: boolean; snippets?: boolean; uploading?: boolean; linkActive?: boolean; onEdit?: () => void;disabled?:boolean;
}) {
  const action = (command: FormatAction) => {onEdit(); onAction(command);};
  const item = (label: string, command: FormatAction) => <button type="button" key={command} aria-label={label} onClick={() => action(command)}>{label}</button>;
  const button = (label: string, icon: ReactNode, command: FormatAction) => <button type="button" title={label} aria-label={label} aria-pressed={command === 'link' ? linkActive : command === 'quote' || command === 'code' ? blockType === command : undefined} onMouseDown={event => event.preventDefault()} onClick={() => action(command)}>{icon}</button>;
  const menuLabel = (label: string) => <span className="toolbar-menu-label">{label}<ChevronDown size={12}/></span>;
  const iconMenu = (label: string, icon: ReactNode) => <span className="toolbar-menu-label" title={label}>{icon}<ChevronDown size={10}/></span>;
  return <div inert={disabled} className={'format-toolbar grouped-toolbar' + (mode === 'source' ? ' source-toolbar' : '')} role="toolbar" aria-label="正文格式" onMouseDownCapture={onCapture}>
    <button type="button" className="editor-mode-toggle" disabled={uploading} title={mode === 'visual' ? '切换为 Markdown' : '切换为富文本'} aria-label={mode === 'visual' ? '切换为 Markdown' : '切换为富文本'} onMouseDown={event => event.preventDefault()} onClick={onMode}>{mode === 'visual' ? <FileCode2 size={18}/> : <FileText size={18}/>}</button>
    <span className="toolbar-divider" aria-hidden="true"/>
    <div className="toolbar-group">{button('撤销', <Undo2 size={16}/>, 'undo')}{button('重做', <Redo2 size={16}/>, 'redo')}</div>
    <span className="toolbar-divider" aria-hidden="true"/>
    <div className="toolbar-group">
    {!compact && <select aria-label="段落格式" value={/^h[1-6]$/.test(blockType) ? blockType : 'paragraph'} onMouseDown={onCaptureBlock} onChange={event => {onEdit(); onBlock(event.target.value);}}><option value="paragraph">正文</option>{[1,2,3,4,5,6].map(level => <option key={level} value={'h' + level}>{level} 级标题</option>)}</select>}
    {button('加粗', <Bold size={16}/>, 'bold')}{button('斜体', <Italic size={16}/>, 'italic')}
    <Popover label="高亮颜色" trigger={iconMenu('高亮颜色', <Highlighter size={17}/>)} className="writing-format-menu writing-palette-menu" menu align="start">
      <div className="writing-palette" aria-label="高亮颜色">{Object.entries(highlightColors).map(([id, color]) => <button type="button" key={id} aria-label={'高亮：' + color.label} title={'高亮：' + color.label} style={{background: color.value}} onClick={() => action(`highlight:${id}`)}/>)}{item('取消高亮', 'highlight:none')}</div>
    </Popover>
    <Popover label="文字颜色" trigger={iconMenu('文字颜色', <Baseline size={17}/>)} className="writing-format-menu writing-palette-menu" menu align="start">
      <div className="writing-palette" aria-label="文字颜色">{Object.entries(textColors).map(([id, color]) => <button type="button" key={id} aria-label={'文字颜色：' + color.label} title={'文字颜色：' + color.label} style={{color: color.value}} onClick={() => action(`color:${id}`)}>A</button>)}{item('默认颜色', 'color:none')}</div>
    </Popover>
    <Popover label="更多格式" trigger={menuLabel('格式')} className="writing-format-menu" menu align="start">
      {item('删除线', 'strikethrough')}{item('行内代码', 'inline-code')}{item('下划线', 'underline')}{item('上标', 'superscript')}{item('下标', 'subscript')}
    </Popover>
    </div>
    <span className="toolbar-divider" aria-hidden="true"/>
    <div className="toolbar-group">
    {!compact && <Popover label="段落对齐" trigger={iconMenu('段落对齐', <AlignLeft size={17}/>)} className="writing-format-menu writing-alignment-menu" menu align="start">
      <div className="writing-alignment-options">{button('左对齐', <AlignLeft size={18}/>, 'align:left')}{button('居中对齐', <AlignCenter size={18}/>, 'align:center')}{button('右对齐', <AlignRight size={18}/>, 'align:right')}{button('两端对齐', <AlignJustify size={18}/>, 'align:justify')}</div>
    </Popover>}
    {button('引用', <Quote size={17}/>, 'quote')}{button('分割线', <Minus size={17}/>, 'divider')}{button('代码块', <Code2 size={17}/>, 'code')}
    </div>
    <span className="toolbar-divider" aria-hidden="true"/>
    <div className="toolbar-group">
    {button('链接', <Link size={16}/>, 'link')}
    <Popover label="插入媒体" trigger={<ImagePlus size={17}/>} className="writing-format-menu" menu align="start">{item('从媒体库选择', 'media')}{item('插入视频', 'video')}</Popover>
    <Popover label="插入内容" trigger={menuLabel('插入')} className="writing-format-menu" menu align="start">
      {item('无序列表', 'bullet')}{item('有序列表', 'ordered')}
      {blockType === 'code' && <label>代码语言<select aria-label="代码语言" value={codeLanguage} onMouseDown={onCaptureLanguage} onChange={event => {onEdit(); onLanguage(event.target.value);}}>{['text','typescript','javascript','python','json','html','css','bash','sql','yaml'].map(language => <option key={language}>{language}</option>)}</select></label>}
      {!compact && <>{item('表格', 'table')}{item('链接按钮', 'button')}{item('脚注', 'footnote')}{item('折叠内容', 'details')}</>}
    </Popover>
    {snippets && !compact && <button type="button" aria-label="常用内容" onClick={() => action('snippets')}>常用内容</button>}
    </div>
  </div>;
}
