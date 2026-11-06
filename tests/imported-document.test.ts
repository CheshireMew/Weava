import { expect, it } from 'vitest';
import { load } from 'cheerio';
import { importedDocument, withoutImportedPromotion } from '../packages/core/src/imported-document.ts';
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
