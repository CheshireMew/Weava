import type {CSSProperties} from 'react';

/** Preview scripts stay disabled. The parent handles the copy button's local clipboard action. */
export function PreviewFrame({src, title, style}: {src: string; title: string; style?: CSSProperties}) {
  return <iframe title={title} src={src + (src.includes('?') ? '&' : '?') + 'embedded=1'} sandbox="allow-same-origin" style={style} onLoad={event => {
    event.currentTarget.contentDocument?.addEventListener('click', async click => {
      const button = (click.target as Element)?.closest?.<HTMLButtonElement>('[data-copy-code]');
      if (!button) return;
      const code = button.closest('.code-block')?.querySelector<HTMLElement>('pre[data-code-source]');
      if (!code) return;
      try { await navigator.clipboard.writeText(decodeURIComponent(code.dataset.codeSource!)); button.textContent = '已复制'; }
      catch { button.textContent = '无法复制，请选中代码复制'; }
    });
  }}/>;
}
