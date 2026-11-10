import {useLayoutEffect} from 'react';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {HorizontalRuleNode} from '@lexical/react/LexicalHorizontalRuleNode';
import {$createParagraphNode, $getRoot, RootNode} from 'lexical';

/** A leading divider needs a text block above it so a caret can land there. */
export function DocumentStartPlugin() {
  const [editor] = useLexicalComposerContext();
  useLayoutEffect(() => {
    const normalize = (root: RootNode) => {
      const first = root.getFirstChild();
      if (first instanceof HorizontalRuleNode) first.insertBefore($createParagraphNode());
    };
    const remove = editor.registerNodeTransform(RootNode, normalize);
    // Include the caret paragraph in the initial snapshot used for undo/save comparisons.
    editor.update(() => normalize($getRoot()), {discrete: true});
    return remove;
  }, [editor]);
  return null;
}
