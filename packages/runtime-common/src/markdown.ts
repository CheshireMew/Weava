import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';

export interface MarkdownFootnote { label: string; source: string }
export function markdownFootnotes(env: any): MarkdownFootnote[] {
  return (env.footnotes?.list ?? []).map((note: any, index: number) => ({
    label: note.label ?? 'inline-' + (index + 1),
    source: note.label ? env.weavaFootnoteSources?.[note.label] ?? '' : note.content ?? '',
  }));
}

/** One syntax parser for published HTML and the visual Markdown editor. */
export function createMarkdownParser() {
  const parser = new MarkdownIt({html: true, linkify: false, typographer: false}).use(footnote);
  // Retain the authored Markdown of each definition before the footnote plugin
  // moves its tokens to the end of the document. No HTML-to-text conversion.
  parser.core.ruler.before('footnote_tail', 'weava-footnote-sources', state => {
    const lines = state.src.split('\n'), definitions: Record<string, string> = {};
    let label: string | undefined, maps: number[][] = [];
    for (const token of state.tokens) {
      if (token.type === 'footnote_reference_open') {label = token.meta.label; maps = [];}
      else if (token.type === 'footnote_reference_close' && label !== undefined) {
        if (maps.length) {
          const start = Math.min(...maps.map(map => map[0])), end = Math.max(...maps.map(map => map[1]));
          const source = lines.slice(start, end);
          source[0] = source[0].replace(/^ {0,3}\[\^[^\]\s]+\]:[ \t]?/, '');
          definitions[label] = [source[0], ...source.slice(1).map(line => line.replace(/^(?: {4}|\t)/, ''))].join('\n').trimEnd();
        }
        label = undefined;
      } else if (label !== undefined && token.map) maps.push(token.map);
    }
    state.env.weavaFootnoteSources = definitions;
  });
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
