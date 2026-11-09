// @vitest-environment happy-dom
import {it, expect} from 'vitest';
import {createHeadlessEditor} from '@lexical/headless';
import {$getRoot, $createTextNode, $createParagraphNode} from 'lexical';
import {HeadingNode, QuoteNode} from '@lexical/rich-text';
import {ListNode, ListItemNode} from '@lexical/list';
import {LinkNode, AutoLinkNode} from '@lexical/link';
import {CodeNode, CodeHighlightNode} from '@lexical/code';
import {TableNode, TableRowNode, TableCellNode} from '@lexical/table';
import {HorizontalRuleNode} from '@lexical/react/LexicalHorizontalRuleNode';
import {MediaNode, EmbedNode} from '../apps/admin/src/editor/nodes.tsx';
import {DetailsNode, ButtonLinkNode, FootnoteNode} from '../apps/admin/src/editor/WritingNodes.tsx';
import {writingDOMImport} from '../apps/admin/src/editor/writing-dom.ts';
import {importMarkdown, supportsVisualEditing} from '../apps/admin/src/editor/markdown.ts';
import {exportMarkdown} from '../apps/admin/src/editor/transformers.tsx';
import {renderDocument} from '../packages/core/src/documents.ts';
import {checkDocumentStructure} from '../packages/core/src/document-inspection.ts';
import {load} from 'cheerio';

function editor() {return createHeadlessEditor({namespace: 'writing-test', nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode, CodeNode, CodeHighlightNode, TableNode, TableRowNode, TableCellNode, HorizontalRuleNode, MediaNode, EmbedNode, DetailsNode, ButtonLinkNode, FootnoteNode], html: {import: writingDOMImport}, onError: error => {throw error;}});}
const document = (source: string) => ({version: 1 as const, format: 'markdown' as const, source});
function roundTrip(source: string) {
  expect(supportsVisualEditing(document(source))).toBe(true);
  const instance = editor(); instance.update(() => importMarkdown(instance, source), {discrete: true});
  const lexical = {version: 1 as const, format: 'lexical' as const, source: instance.getEditorState().toJSON() as any};
  checkDocumentStructure(lexical);
  return {source: instance.getEditorState().read(() => exportMarkdown()), lexical};
}
const source = `## 写作格式

**粗体** *斜体* ~~删除线~~ \`inline code\`，<u>下划线</u> H<sub>2</sub>O x<sup>2</sup>。

<mark class="weava-highlight-green"><strong>绿色加粗</strong></mark> <span class="weava-color-blue"><em>蓝色斜体</em></span>。

<a class="weava-link-button" href="entry:target">阅读更多</a>

---

<div class="weava-align-center">

居中的段落。

</div>

<details class="weava-details"><summary>补充说明 &amp; 来源</summary>

### 小标题

- **第一项**
- <mark class="weava-highlight-pink">第二项</mark>[^source]

<details class="weava-details"><summary>更多</summary>

内层内容。

</details>

</details>

正文引用[^source]，另一个脚注[^next]。

[^source]: 这是**来源**与[链接](https://example.com)。

    第二段内容。

    \`\`\`js
      code()
    \`\`\`

[^next]: 第二个脚注。

<figure><audio src="/media/audio.mp3" controls preload="metadata"></audio><figcaption>音频说明</figcaption></figure>

<figure><video src="/media/video.mp4" controls preload="metadata"></video><figcaption>视频说明</figcaption></figure>`;

function inspect(source: string) {
  const $ = load(renderDocument(document(source)), null, false);
  return {headings: $('h2,h3').map((_, el) => $(el).text()).get(), strike: $('s').text(), code: $('code').first().text(), highlight: $('mark').map((_, el) => [[$(el).attr('class'), $(el).text()]]).get(), color: $('.weava-color-blue').text(), details: $('details').length, summaries: $('summary').map((_, el) => $(el).text()).get(), button: $('a.weava-link-button').attr('href'), alignment: $('.weava-align-center').text().trim(), refs: $('.footnote-ref').text(), notes: $('.footnote-item').map((_, el) => $(el).text().replace(/\s+/g, '')).get(), media: $('audio,video').map((_, el) => $(el).attr('src')).get(), captions: $('figcaption').map((_, el) => $(el).text()).get()};
}
it('keeps extended writing formats through repeated visual editing, Markdown and public rendering', () => {
  const original = inspect(source);
  let next = source;
  for (let pass = 0; pass < 3; pass++) {next = roundTrip(next).source; expect(inspect(next)).toEqual(original);}
});
it('balances adjacent overlapping emphasis, color, highlight and literal code', () => {
  const instance = editor();
  instance.update(() => $getRoot().append($createParagraphNode().append(
    $createTextNode('A').toggleFormat('bold'),
    $createTextNode('B').toggleFormat('bold').toggleFormat('italic').toggleFormat('highlight').setStyle('background-color: #fff0a8; color: #175cd3'),
    $createTextNode('C').toggleFormat('bold'),
    $createTextNode('a`<b>&*bold*_[link](https://example.com)').toggleFormat('code').toggleFormat('highlight'),
  )), {discrete: true});
  const output = instance.getEditorState().read(() => exportMarkdown());
  const $ = load(renderDocument(document(output)), null, false);
  expect($('strong').text()).toBe('ABC'); expect($('mark').first().text()).toBe('B'); expect($('em').text()).toBe('B'); expect($('code').text()).toBe('a`<b>&*bold*_[link](https://example.com)');
  expect(inspect(roundTrip(output).source)).toEqual(inspect(output));
});
it('retains unreferenced footnote definitions when editing source and inserting more references later', () => {
  const next = roundTrip('正文[^one]。\n\n[^one]: 已使用。\n\n[^unused]: 备用内容。').source;
  expect(next).toContain('[^unused]: 备用内容。'); expect(next).toContain('[^one]: 已使用。');
});
it('retains nested list structure when the parent item also has rich highlights', () => {
  const original = '- <mark class="weava-highlight-yellow">父项目</mark>\n  - **子项目**\n  - <span class="weava-color-blue">蓝色子项目</span>\n- 普通项目';
  const output = roundTrip(original).source, $ = load(renderDocument(document(output)), null, false);
  expect($('ul ul li')).toHaveLength(2); expect($('ul > li > mark').first().text()).toBe('父项目'); expect($('.weava-color-blue').text()).toBe('蓝色子项目');
});
it('keeps paragraph and list boundaries inside a quote containing rich colors', () => {
  const next = roundTrip('> <mark class="weava-highlight-yellow">引用正文</mark>\n>\n> 第二段\n>\n> - 第一个要点\n> - <span class="weava-color-blue">第二个要点</span>').source;
  const $ = load(renderDocument(document(next)), null, false);
  expect($('blockquote p')).toHaveLength(2); expect($('blockquote ul li')).toHaveLength(2); expect($('mark').text()).toBe('引用正文');
});
