import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import typescript from 'shiki/langs/typescript.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import python from 'shiki/langs/python.mjs';
import json from 'shiki/langs/json.mjs';
import html from 'shiki/langs/html.mjs';
import css from 'shiki/langs/css.mjs';
import shellscript from 'shiki/langs/shellscript.mjs';
import sql from 'shiki/langs/sql.mjs';
import yaml from 'shiki/langs/yaml.mjs';
import theme from 'shiki/themes/github-light.mjs';
const highlighter = createHighlighterCoreSync({ themes: [theme], langs: [typescript, javascript, python, json, html, css, shellscript, sql, yaml], engine: createJavaScriptRegexEngine() });
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const aliases: Record<string, string> = { ts: 'typescript', js: 'javascript', py: 'python', sh: 'shellscript', bash: 'shellscript', yml: 'yaml', xml: 'html' };
export function renderCode(source: string, info = '', options: { lineNumbers?: boolean; highlight?: string } = {}) {
  const name = info.trim().split(/\s/)[0] || 'text', lang = aliases[name] ?? name;
  const supported = highlighter.getLoadedLanguages().includes(lang);
  const highlighted = new Set<number>();
  for (const value of (options.highlight ?? /\{([^}]+)\}/.exec(info)?.[1] ?? '').split(',')) {
    const [from, to] = value.trim().split('-').map(Number);
    if (Number.isSafeInteger(from) && from > 0) for (let n = from; n <= Math.min(to || from, from + 5000); n++) highlighted.add(n);
  }
  const tokens = supported && source.length <= 100000 ? highlighter.codeToTokensBase(source, { lang, theme: 'github-light' }) : source.split('\n').map((line) => [{ content: line, color: '' }]);
  const lines = tokens.map((line, index) => `<span class="code-line${highlighted.has(index + 1) ? ' highlighted' : ''}" data-line="${index + 1}">${line.map((token) => `<span class="syntax-${(token.color || '').replace('#', '').toLowerCase()}">${escape(token.content)}</span>`).join('')}</span>`).join('\n');
  return `<div class="code-block"><button type="button" data-copy-code>复制代码</button><pre class="${options.lineNumbers || /\blinenos\b/.test(info) ? 'line-numbers' : ''}" data-language="${escape(name)}" data-code-source="${encodeURIComponent(source)}"><code class="language-${escape(name)}">${lines}</code></pre></div>`;
}
