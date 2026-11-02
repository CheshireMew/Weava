import {expect,it} from 'vitest';
import MarkdownIt from 'markdown-it';
import {sanitize,renderDocument} from '../packages/core/src/documents.ts';
it('removes active URI schemes from allowed media attributes and preserves ordinary media',()=>{
  const html=sanitize('<video poster="javascript:alert(1)" controls><source src="https://example.com/film.mp4"></video><a href="javascript:alert(2)">link</a>');
  expect(html).not.toContain('javascript:');expect(html).toContain('https://example.com/film.mp4');
  expect(renderDocument({version:1,format:'markdown',source:'[unsafe](javascript:alert(1))'})).not.toContain('href="javascript:');
});
it('renders an unterminated multi-line reference without quadratic parser work',()=>{
  const md=new MarkdownIt();const source='[a]: /u "'+'x\n'.repeat(150000),started=performance.now();
  expect(md.render(source)).toContain('[a]');expect(performance.now()-started).toBeLessThan(2000);
});
