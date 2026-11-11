import {useEffect} from 'react';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {HorizontalRuleNode} from '@lexical/react/LexicalHorizontalRuleNode';
import {$addUpdateTag,$createNodeSelection,$getNearestNodeFromDOMNode,$getSelection,$isNodeSelection,$setSelection,CLICK_COMMAND,COMMAND_PRIORITY_HIGH,SKIP_SCROLL_INTO_VIEW_TAG} from 'lexical';

/** Select the rule before the browser places a caret in the neighbouring paragraph. */
export function DividerSelectionPlugin() {
  const [editor]=useLexicalComposerContext();
  useEffect(()=>{
    const ruleFor=(target:EventTarget|null)=>target instanceof Element?target.closest('hr.editor-divider'):null;
    const select=(element:Element,extend:boolean)=>{
      const node=$getNearestNodeFromDOMNode(element);
      if(!(node instanceof HorizontalRuleNode))return false;
      $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG);
      const current=$getSelection(),selection=extend&&$isNodeSelection(current)?current:$createNodeSelection();
      selection.add(node.getKey());$setSelection(selection);
      return true;
    };
    const down=(event:MouseEvent)=>{
      const rule=ruleFor(event.target);
      if(event.button!==0||!rule)return;
      event.preventDefault();
      editor.getRootElement()?.focus({preventScroll:true});
      editor.update(()=>select(rule,event.shiftKey),{discrete:true});
    };
    const removeRoot=editor.registerRootListener((root,previous)=>{
      previous?.removeEventListener('mousedown',down,true);
      root?.addEventListener('mousedown',down,true);
    });
    const removeClick=editor.registerCommand(CLICK_COMMAND,event=>{
      const rule=ruleFor(event.target);
      return !!rule&&select(rule,event.shiftKey);
    },COMMAND_PRIORITY_HIGH);
    return ()=>{removeRoot();removeClick();};
  },[editor]);
  return null;
}
