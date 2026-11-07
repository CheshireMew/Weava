import { expect, it } from 'vitest';
import { load } from 'cheerio';
import { importedDocument, withoutImportedPromotion, withoutEmptyDocumentParagraphs, withoutStructuralWhitespace } from '../packages/core/src/imported-document.ts';
import { renderDocument } from '../packages/core/src/documents.ts';

it('converts authored content while excluding only the old injected promotion', () => {
  const source = '<p>正文：币安、OKX 也是文字。<strong>重点</strong> <a href="/guide/" target="_blank">查看指南</a></p><ol start="3"><li>第三项<ul><li>子项</li></ul></li></ol><blockquote><p>引用原文</p></blockquote><pre><code class="language-js">a &lt; b\n  next()</code></pre><table><tr><th>标题</th><td colspan="2">内容</td></tr></table><a href="/original/"><img src="/media/a.png" alt="说明"></a><iframe src="https://www.youtube.com/embed/a" title="视频"></iframe><hr><div id="crypto-card-final-v8-pure"><h3>创作不易，感谢支持</h3><a href="/ad/">注册</a></div>';
  const document = importedDocument(source), $ = load(renderDocument(document));
  expect(document.format).toBe('lexical');
  expect($.text()).not.toContain('创作不易');
  expect($.text()).toContain('币安、OKX 也是文字');
  expect($('ol').attr('start')).toBe('3');
  expect($('td').attr('colspan')).toBe('2');
  expect($('img').parent().attr('href')).toBe('/original/');
  expect($('iframe').attr('src')).toBe('https://www.youtube.com/embed/a');
  expect($('pre').attr('data-code-source')).toBe(encodeURIComponent('a < b\n  next()'));
  expect($('a[href="/guide/"]').text()).toBe('查看指南');
});

it('does not silently discard unsupported authored elements', () => {
  expect(() => importedDocument('<custom-content>保留我</custom-content>')).toThrow('custom-content');
  const source = '<p>创作不易，感谢支持</p>';
  expect(withoutImportedPromotion(source)).toBe(source);
});

it('omits imported blank paragraphs while preserving code spacing and real paragraph breaks', () => {
  const document = importedDocument('<p> </p><p><br></p><p>第一段</p><p>&nbsp;</p><pre><code>first\n\n  next</code></pre><p>第二段</p><p></p>');
  const $ = load(renderDocument(document));
  expect($('p').map((_i, node) => $(node).text()).get()).toEqual(['第一段', '第二段']);
  expect($('pre').attr('data-code-source')).toBe(encodeURIComponent('first\n\n  next'));
  expect(renderDocument(importedDocument('<p id="jump"> </p><p>正文</p>'))).toContain('id="jump"');
});

it('cleans existing documents without mutating content or removing an empty draft insertion point', () => {
  const document = importedDocument('<p>正文</p><pre><code>a\n\nb</code></pre>');
  const source = document.source as any;
  const blank = { type: 'paragraph', version: 1, children: [{ type: 'text', version: 1, text: '\u00a0' }] };
  source.root.children.unshift(blank); source.root.children.push(blank);
  const original = JSON.stringify(document), clean = withoutEmptyDocumentParagraphs(document);
  expect((clean.source as any).root.children.map((node: any) => node.type)).toEqual(['paragraph', 'code']);
  expect(JSON.stringify(document)).toBe(original);
  expect(withoutEmptyDocumentParagraphs(clean)).toBe(clean);
  const draft = importedDocument('<p></p>');
  expect(withoutEmptyDocumentParagraphs(draft)).toBe(draft);
});

it('keeps HTML indentation out of table and list structure without changing code whitespace', () => {
  const document = importedDocument('<ul>\n<li>列表项</li>\n</ul><table>\n<tr>\n<td>表格内容</td>\n</tr>\n</table><pre><code>  code\n\n</code></pre>');
  const nodes = (document.source as any).root.children;
  expect(nodes[0].children.map((node: any) => node.type)).toEqual(['listitem']);
  expect(nodes[1].children.map((node: any) => node.type)).toEqual(['tablerow']);
  expect(nodes[1].children[0].children.map((node: any) => node.type)).toEqual(['tablecell']);
  expect(withoutStructuralWhitespace(document)).toBe(document);
  expect(renderDocument(document)).toContain(encodeURIComponent('  code\n\n'));
});
