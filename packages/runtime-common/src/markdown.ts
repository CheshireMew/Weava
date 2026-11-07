import MarkdownIt from 'markdown-it';

/** One syntax parser for published HTML and the visual Markdown editor. */
export function createMarkdownParser() {
  const parser = new MarkdownIt({html: true, linkify: false, typographer: false});
  parser.core.ruler.after('inline', 'weava-tasks', state => {
    const lists: typeof state.tokens = [];
    state.tokens.forEach((token, index) => {
      if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') lists.push(token);
      if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') lists.pop();
      if (token.type !== 'inline' || state.tokens[index - 1]?.type !== 'paragraph_open' || state.tokens[index - 2]?.type !== 'list_item_open') return;
      const match = /^\[([ xX])\]\s+/.exec(token.content), first = token.children?.[0];
      if (!match || first?.type !== 'text') return;
      token.content = token.content.slice(match[0].length); first.content = first.content.slice(match[0].length);
      const checkbox = new state.Token('html_inline', '', 0);
      checkbox.meta = {weavaTask: true};
      checkbox.content = '<input type="checkbox" disabled' + (match[1].toLowerCase() === 'x' ? ' checked' : '') + '> ';
      token.children!.unshift(checkbox);
      state.tokens[index - 2].attrJoin('class', 'task-list-item');
      lists.at(-1)?.attrJoin('class', 'contains-task-list');
    });
  });
  return parser;
}
