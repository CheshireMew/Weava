import {expect,it} from 'vitest';
import {load} from 'cheerio';
import {renderArticleBody} from '../apps/web/src/themes/article-body.ts';
it('reuses stable article markup without carrying another request edit link or interaction count',()=>{
 const html='<div><header class="article-heading"><h1>Article</h1><div class="meta">Author</div></header><p>Body</p></div>';
 const first=load(renderArticleBody(html,'<a href="/admin/">Edit</a>','<button>1 like</button>'));
 expect(first('.nl-article-byline > .meta > a').attr('href')).toBe('/admin/');expect(first('.nl-article-byline > button').text()).toBe('1 like');
 const next=load(renderArticleBody(html,'','<button>2 likes</button>'));
 expect(next('a')).toHaveLength(0);expect(next('button').text()).toBe('2 likes');expect(next('p').text()).toBe('Body');
 expect(renderArticleBody(html)).not.toContain('weava-edit-');
});
it('preserves the body when a template has no byline and varies its actions on every request',()=>{
 const html='<p>Standalone body</p>';
 expect(renderArticleBody(html,'<a>Edit</a>','<button>Share</button>')).toBe('<a>Edit</a><button>Share</button>'+html);
 expect(renderArticleBody(html)).toBe(html);
});
