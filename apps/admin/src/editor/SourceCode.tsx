import {forwardRef,useImperativeHandle,useLayoutEffect,useRef,type DragEvent,type ClipboardEvent} from 'react';
import {EditorState,EditorSelection,type Extension} from '@codemirror/state';
import {EditorView,keymap} from '@codemirror/view';
import {defaultKeymap,history,undo,redo} from '@codemirror/commands';
import {allowFileDrop,clipboardImages,hasDroppedFiles} from '../file-drop.tsx';
import {usePendingEditWork} from '../EditSessions.tsx';

export interface SourceInput {readonly selectionStart:number;readonly selectionEnd:number;scrollTop:number;focus(options?:FocusOptions):void;setSelectionRange(start:number,end:number):void;flush?():void;undo?():void;redo?():void}
export default forwardRef<SourceInput,{source:string;historyRevision:number;onInput:(source:string,start:number,end:number)=>void;onSelection:(start:number,end:number)=>void;onDrop:(event:DragEvent<HTMLElement>,offset:number)=>void;onPaste?:(event:ClipboardEvent<HTMLElement>,offset:number)=>void}>(function SourceCode(props,ref){
 const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),latest=useRef(props),external=useRef(false),applied=useRef(props.source),dirty=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);latest.current=props;
 const extensions=useRef<Extension[]>([]),historyRevision=useRef(props.historyRevision);
 const flush=()=>{
  clearTimeout(timer.current);timer.current=undefined;
  const editor=view.current;if(!editor||!dirty.current)return;
  dirty.current=false;applied.current=editor.state.doc.toString();
  const selection=editor.state.selection.main;latest.current.onInput(applied.current,selection.from,selection.to);
 };
 const flushLatest=useRef(flush);flushLatest.current=flush;
 usePendingEditWork(()=>{if(!dirty.current)return null;flushLatest.current();return Promise.resolve();});
 useImperativeHandle(ref,()=>({
  get selectionStart(){return view.current?.state.selection.main.from??0;},get selectionEnd(){return view.current?.state.selection.main.to??0;},
  get scrollTop(){return view.current?.scrollDOM.scrollTop??0;},set scrollTop(value){if(view.current)view.current.scrollDOM.scrollTop=value;},
  focus(){view.current?.focus();},setSelectionRange(start,end){const editor=view.current;if(editor)editor.dispatch({selection:EditorSelection.single(Math.min(start,editor.state.doc.length),Math.min(end,editor.state.doc.length))});},
  flush:()=>flushLatest.current(),
  undo(){const editor=view.current;if(editor){undo(editor);flushLatest.current();}},
  redo(){const editor=view.current;if(editor){redo(editor);flushLatest.current();}},
 }),[]);
 useLayoutEffect(()=>{
  extensions.current=[
   keymap.of(defaultKeymap),history({minDepth:100}),EditorView.lineWrapping,EditorView.contentAttributes.of({'aria-label':'正文源码','role':'textbox','aria-multiline':'true','spellcheck':'false'}),
   EditorView.theme({'&':{height:'60dvh',minHeight:'450px',fontSize:'14px'},'.cm-scroller':{fontFamily:'Consolas, monospace',lineHeight:'1.5'},'&.cm-focused':{outline:'none'},'.cm-content':{padding:'16px 0'}}),
   EditorView.updateListener.of(update=>{if(external.current)return;const selection=update.state.selection.main;if(update.docChanged){dirty.current=true;clearTimeout(timer.current);timer.current=setTimeout(()=>flushLatest.current(),150);}else if(update.selectionSet){flushLatest.current();latest.current.onSelection(selection.from,selection.to);}}),
  ];
  const editor=new EditorView({parent:host.current!,state:EditorState.create({doc:latest.current.source,extensions:extensions.current})});view.current=editor;
  const hidden=()=>{if(document.visibilityState==='hidden')flushLatest.current();},unload=()=>flushLatest.current();
  editor.contentDOM.addEventListener('blur',unload);window.addEventListener('beforeunload',unload,true);document.addEventListener('visibilitychange',hidden);
  return()=>{flushLatest.current();clearTimeout(timer.current);editor.contentDOM.removeEventListener('blur',unload);window.removeEventListener('beforeunload',unload,true);document.removeEventListener('visibilitychange',hidden);view.current=null;editor.destroy();};
 },[]);
 useLayoutEffect(()=>{const editor=view.current;if(editor&&(applied.current!==props.source||historyRevision.current!==props.historyRevision)){external.current=true;try{
  dirty.current=false;clearTimeout(timer.current);applied.current=props.source;
  if(historyRevision.current!==props.historyRevision){
   const selection=editor.state.selection.main,scroll=editor.scrollDOM.scrollTop;
   editor.setState(EditorState.create({doc:props.source,selection:EditorSelection.single(Math.min(selection.anchor,props.source.length),Math.min(selection.head,props.source.length)),extensions:extensions.current}));
   editor.scrollDOM.scrollTop=scroll;historyRevision.current=props.historyRevision;
  }else editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:props.source}});
 }finally{external.current=false;}}},[props.source,props.historyRevision]);
 return <div ref={host} className="markdown-code" onDragOver={allowFileDrop} onDropCapture={event=>{if(!hasDroppedFiles(event.dataTransfer))return;flushLatest.current();const editor=view.current;props.onDrop(event,editor?.posAtCoords({x:event.clientX,y:event.clientY})??editor?.state.selection.main.head??0);}} onPasteCapture={event=>{if(!clipboardImages(event.clipboardData).length)return;flushLatest.current();props.onPaste?.(event,view.current?.state.selection.main.head??0);}}/>;
});
