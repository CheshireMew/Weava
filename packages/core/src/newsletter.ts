import type { Release,PublishedEntry } from '@weava/contracts';
import type { Analytics } from './analytics.ts';
import { releaseIndex } from './release-index.ts';
import { featuredEntries } from './editorial.ts';
const catalogs=new WeakMap<Release,ReturnType<typeof create>>();
const covers=new WeakMap<PublishedEntry,string>();
export function newsletterCover(entry:PublishedEntry){
  if(entry.cover)return entry.cover;let cover=covers.get(entry);
  if(cover===undefined){cover=entry.html.match(/<img\b[^>]*\bsrc=["']([^"']+)/i)?.[1]??'';covers.set(entry,cover);}return cover;
}
function create(release:Release){
  const posts=releaseIndex(release).posts.map(item=>Object.create(item,{cover:{enumerable:true,get:()=>newsletterCover(item)}}) as PublishedEntry);
  const pages=release.entries.filter(item=>item.kind==='page'),counts=new Map<string,Set<string>>();
  for(const post of posts)for(const key of new Set([...(post.termIds?.categories??[]),...post.categories])){const members=counts.get(key)??new Set<string>();members.add(post.id);counts.set(key,members);}
  const paths=new Map<string,string>();for(const page of pages)for(const block of page.blocks)if(block.props.category&&!paths.has(block.props.category))paths.set(block.props.category,page.path);
  const categories=[...new Map([...release.settings.taxonomies,...(release.terms??[]).filter(term=>term.kind==='category')].map(term=>[term.id,term])).values()].map(category=>({...category,count:new Set([...(counts.get(category.id)??[]),...(counts.get(category.label)??[])]).size,path:paths.get(category.id)??paths.get(category.label)??('/search/?category='+encodeURIComponent(category.id))})).filter(item=>item.count&&item.path);
  const archive=pages.find(item=>item.template==='newsletter-archive'||item.fields.newsletterLayout==='archive');
  return {posts,byId:new Map(posts.map(post=>[post.id,post])),featured:featuredEntries(posts,release.settings.featuredOrder),categories,archiveUrl:archive?.path??'/search/',rankings:new WeakMap<Analytics,{at:number;popular:PublishedEntry[];totals:Map<string,number>}>()};
}
export function newsletterCatalog(release:Release){let value=catalogs.get(release);if(!value){value=create(release);catalogs.set(release,value);}return value;}
export function newsletterRanking(release:Release,analytics:Analytics,clock=Date.now()){
  const catalog=newsletterCatalog(release),old=catalog.rankings.get(analytics);if(old&&clock-old.at<10000)return old;
  const totals=analytics.viewTotals(catalog.posts),popular=[...catalog.posts].sort((a,b)=>(totals.get(b.id)??0)-(totals.get(a.id)??0)||String(b.publishedAt).localeCompare(String(a.publishedAt)));
  const value={at:clock,popular,totals};catalog.rankings.set(analytics,value);return value;
}
