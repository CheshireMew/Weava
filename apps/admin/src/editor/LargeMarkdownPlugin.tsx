import {useLayoutEffect,type Dispatch,type SetStateAction,type RefObject} from 'react';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {$getRoot,$setState,CLEAR_HISTORY_COMMAND,HISTORY_MERGE_TAG,createEditor,type CreateEditorArgs} from 'lexical';
import {footnoteOrphans,markdownChunks,markdownNodes} from './markdown.ts';
import {writingDOMImport} from './writing-dom.ts';

/** Build large documents a few hundred blocks at a time, yielding between DOM commits. */
export function LargeMarkdownPlugin({source,progress,onError,nodes}:{source:string;progress:Dispatch<SetStateAction<number|null>>;onError:RefObject<(message:string)=>void>;nodes:CreateEditorArgs['nodes']}){
 const [editor]=useLexicalComposerContext();
 useLayoutEffect(()=>{
  let active=true,timer:ReturnType<typeof setTimeout>|undefined,index=0;
  const chunks=markdownChunks(source),staged=createEditor({nodes,html:{import:writingDOMImport},editable:false,onError:error=>{throw error;}});editor.setEditable(false);progress(0);
  const step=()=>{
   if(!active)return;
   try{
    staged.update(()=>{const root=$getRoot();if(!index){root.clear();$setState(root,footnoteOrphans,{});}root.append(...markdownNodes(staged,source,chunks[index]));},{discrete:true,tag:HISTORY_MERGE_TAG});
    index++;
    if(index<chunks.length){progress(Math.round(index/chunks.length*100));timer=setTimeout(step,0);}
    else{editor.setEditorState(staged.getEditorState(),{tag:HISTORY_MERGE_TAG});editor.dispatchCommand(CLEAR_HISTORY_COMMAND,undefined);editor.setEditable(true);progress(null);}
   }catch(error:any){onError.current(error.message);}
  };
  timer=setTimeout(step,0);
  return()=>{active=false;clearTimeout(timer);};
 },[editor,source,progress,onError,nodes]);
 return null;
}
