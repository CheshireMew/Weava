import {forwardRef,useImperativeHandle,useLayoutEffect,useRef,type DragEvent} from 'react';
import {EditorState,EditorSelection} from '@codemirror/state';
import {EditorView,keymap} from '@codemirror/view';
import {defaultKeymap} from '@codemirror/commands';
import {allowFileDrop,hasDroppedFiles} from '../file-drop.tsx';

export interface SourceInput {readonly selectionStart:number;readonly selectionEnd:number;scrollTop:number;focus(options?:FocusOptions):void;setSelectionRange(start:number,end:number):void}
export default forwardRef<SourceInput,{source:string;onInput:(source:string,start:number,end:number)=>void;onSelection:(start:number,end:number)=>void;onDrop:(event:DragEvent<HTMLElement>,offset:number)=>void}>(function SourceCode(props,ref){
 const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),latest=useRef(props),external=useRef(false);latest.current=props;
 useImperativeHandle(ref,()=>({
  get selectionStart(){return view.current?.state.selection.main.from??0;},get selectionEnd(){return view.current?.state.selection.main.to??0;},
  get scrollTop(){return view.current?.scrollDOM.scrollTop??0;},set scrollTop(value){if(view.current)view.current.scrollDOM.scrollTop=value;},
  focus(){view.current?.focus();},setSelectionRange(start,end){const editor=view.current;if(editor)editor.dispatch({selection:EditorSelection.single(Math.min(start,editor.state.doc.length),Math.min(end,editor.state.doc.length))});},
 }),[]);
 useLayoutEffect(()=>{
  const editor=new EditorView({parent:host.current!,state:EditorState.create({doc:latest.current.source,extensions:[
   keymap.of(defaultKeymap),EditorView.lineWrapping,EditorView.contentAttributes.of({'aria-label':'正文源码','role':'textbox','aria-multiline':'true','spellcheck':'false'}),
   EditorView.theme({'&':{height:'60dvh',minHeight:'450px',fontSize:'14px'},'.cm-scroller':{fontFamily:'Consolas, monospace',lineHeight:'1.5'},'&.cm-focused':{outline:'none'},'.cm-content':{padding:'16px 0'}}),
   EditorView.updateListener.of(update=>{if(external.current)return;const selection=update.state.selection.main;if(update.docChanged)latest.current.onInput(update.state.doc.toString(),selection.from,selection.to);else if(update.selectionSet)latest.current.onSelection(selection.from,selection.to);}),
  ]})});view.current=editor;
  return()=>{view.current=null;editor.destroy();};
 },[]);
 useLayoutEffect(()=>{const editor=view.current;if(editor&&editor.state.doc.toString()!==props.source){external.current=true;try{editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:props.source}});}finally{external.current=false;}}},[props.source]);
 return <div ref={host} className="markdown-code" onDragOver={allowFileDrop} onDropCapture={event=>{if(!hasDroppedFiles(event.dataTransfer))return;const editor=view.current;props.onDrop(event,editor?.posAtCoords({x:event.clientX,y:event.clientY})??editor?.state.selection.main.head??0);}}/>;
});
