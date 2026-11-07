import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const languages=new Set(['typescript','javascript','python','json','html','css','shellscript','sql','yaml']);
let highlighter:ReturnType<typeof import('shiki/core')['createHighlighterCoreSync']>|undefined;
function languageHighlighter(lang:string){
  if(!highlighter){
    const {createHighlighterCoreSync}=require('shiki/core') as typeof import('shiki/core');
    const {createJavaScriptRegexEngine}=require('shiki/engine/javascript') as typeof import('shiki/engine/javascript');
    highlighter=createHighlighterCoreSync({themes:[require('shiki/themes/github-light.mjs').default],langs:[],engine:createJavaScriptRegexEngine()});
  }
  if(!highlighter.getLoadedLanguages().includes(lang))highlighter.loadLanguageSync(require('shiki/langs/'+lang+'.mjs').default);
  return highlighter;
}
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const aliases: Record<string, string> = { ts: 'typescript', js: 'javascript', py: 'python', sh: 'shellscript', bash: 'shellscript', yml: 'yaml', xml: 'html' };
export function renderCode(source: string, info = '', options: { lineNumbers?: boolean; highlight?: string } = {}) {
  const name = info.trim().split(/\s/)[0] || 'text', lang = aliases[name] ?? name;
  const supported = languages.has(lang)&&source.length<=100000;
  const highlighted = new Set<number>();
  for (const value of (options.highlight ?? /\{([^}]+)\}/.exec(info)?.[1] ?? '').split(',')) {
    const [from, to] = value.trim().split('-').map(Number);
    if (Number.isSafeInteger(from) && from > 0) for (let n = from; n <= Math.min(to || from, from + 5000); n++) highlighted.add(n);
  }
  const tokens = supported ? languageHighlighter(lang).codeToTokensBase(source, { lang, theme: 'github-light' }) : source.split('\n').map((line) => [{ content: line, color: '' }]);
  const visible = source.endsWith('\n') && tokens.at(-1)?.every(token => !token.content) ? tokens.slice(0, -1) : tokens;
  const lines = visible.map((line, index) => `<span class="code-line${highlighted.has(index + 1) ? ' highlighted' : ''}" data-line="${index + 1}">${line.map((token) => `<span class="syntax-${(token.color || '').replace('#', '').toLowerCase()}">${escape(token.content)}</span>`).join('')}</span>`).join('\n') + (source.endsWith('\n') ? '\n' : '');
  return `<div class="code-block"><button type="button" data-copy-code>复制代码</button><pre class="${options.lineNumbers || /\blinenos\b/.test(info) ? 'line-numbers' : ''}" data-language="${escape(name)}" data-code-source="${encodeURIComponent(source)}"><code class="language-${escape(name)}">${lines}</code></pre></div>`;
}
