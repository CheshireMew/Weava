import {expect, it} from 'vitest';
import {load} from 'cheerio';
import {renderDocument, articleOutline} from '../packages/core/src/documents.ts';
import {composeMetadata, type PageMetadata} from '../packages/core/src/seo.ts';

const render = (source: string) => load(renderDocument({version: 1, format: 'markdown', source}), null, false);

it('renders headings, emphasis, escapes, hard breaks, reference links and nested lists', () => {
  const $ = render('# 一级\n\n## 二级\n\n### 三级\n\n#### 四级\n\n##### 五级\n\n###### 六级\n\n**加粗** *斜体* ~~删除~~ `行内 <tag>` \\*星号\\*\n\n第一行  \n第二行\n\n[参考][ref] <https://example.com/auto>\n\n[ref]: https://example.com/a_(b) "参考标题"\n\n3. 第三项\n   - 子项\n4. 第四项');
  expect($('h1,h2,h3,h4,h5,h6')).toHaveLength(6);
  expect($('strong').text()).toBe('加粗'); expect($('em').text()).toBe('斜体'); expect($('s').text()).toBe('删除');
  expect($('code').text()).toBe('行内 <tag>'); expect($.text()).toContain('*星号*'); expect($('br')).toHaveLength(1);
  expect($('a').first().attr('href')).toBe('https://example.com/a_(b)'); expect($('a').first().attr('title')).toBe('参考标题');
  expect($('ol').attr('start')).toBe('3'); expect($('ol ul li').text()).toBe('子项');
});

it('retains table alignment, escaped pipes and inline formatting', () => {
  const $ = render('| 左列 | 中列 | 右列 |\n| :--- | :---: | ---: |\n| **粗体** | a\\|b | `代码` |');
  expect($('th').map((_i, cell) => $(cell).attr('align')).get()).toEqual(['left','center','right']);
  expect($('td').map((_i, cell) => $(cell).attr('align')).get()).toEqual(['left','center','right']);
  expect($('td').eq(1).text()).toBe('a|b'); expect($('td strong').text()).toBe('粗体'); expect($('td code').text()).toBe('代码');
});

it('renders checked and unchecked tasks as read-only checkboxes', () => {
  const $ = render('- [x] 已完成\n- [ ] 待完成\n  - [x] 嵌套任务');
  expect($('input[type="checkbox"]')).toHaveLength(3);
  expect($('input[checked]')).toHaveLength(2); expect($('input[disabled]')).toHaveLength(3);
  expect($.text()).not.toContain('[x]');
});

it.each([
  ['backticks', '```js\nconst x = "<tag>";\n\n\tcall();\n```', 'const x = "<tag>";\n\n\tcall();\n'],
  ['tildes', '~~~python\nprint("你好")\n~~~', 'print("你好")\n'],
  ['indentation', '    first()\n\n      next()\n', 'first()\n\n  next()\n'],
  ['nested fence', '````markdown\n```js\nrun()\n```\n````', '```js\nrun()\n```\n'],
])('renders %s code with an exact copy source', (_name, markdown, expected) => {
  const $ = render(markdown);
  expect($('[data-copy-code]')).toHaveLength(1);
  expect(decodeURIComponent($('pre').attr('data-code-source')!)).toBe(expected);
  expect($('pre code').text()).toBe(expected);
  expect($('.code-line')).toHaveLength(expected.split('\n').length - 1);
});

it('keeps image links, image titles and HTML detail content readable', () => {
  const $ = render('[![图片](https://example.com/a_(b).png "图片标题")](https://example.com/full)\n\n<details><summary>展开说明</summary><p>完整内容</p></details>');
  expect($('img').attr('src')).toBe('https://example.com/a_(b).png'); expect($('img').attr('title')).toBe('图片标题');
  expect($('img').parent().attr('href')).toBe('https://example.com/full'); expect($('details summary').text()).toBe('展开说明'); expect($('details p').text()).toBe('完整内容');
});

it('keeps duplicate headings and fourth-level outline links unique without indexing code headings', () => {
  const result = articleOutline(renderDocument({version:1,format:'markdown',source:'## 同名\n\n### 同名\n\n#### 四级\n\n```md\n## 代码里的标题\n```'}));
  expect(result.items).toHaveLength(3); expect(new Set(result.items.map(item => item.id)).size).toBe(3);
  const $ = load(result.html); for (const item of result.items) expect($('[id="'+item.id+'"]').text()).toBe(item.title);
});

it('provides code copying for direct extension previews and lets embedded previews use the parent handler', () => {
  const meta = {title:'预览',socialTitle:'预览',description:'',canonical:'https://example.com/post/',robots:'noindex',language:'zh-CN',siteName:'站点',ogType:'article',schema:{'@context':'https://schema.org','@graph':[]}} as unknown as PageMetadata;
  const html = '<html><head></head><body>' + renderDocument({version:1,format:'markdown',source:'```txt\ncopy\n```'}) + '<script>unrelated()</script></body></html>';
  const direct = load(composeMetadata(html, meta, {preview:true}));
  expect(direct('script:not([type="application/ld+json"])').map((_i,node)=>direct(node).attr('src')).get()).toEqual(['/weava-code.js']);
  const embedded = load(composeMetadata(html, meta, {preview:true,embedded:true}));
  expect(embedded('script:not([type="application/ld+json"])')).toHaveLength(0);
});
