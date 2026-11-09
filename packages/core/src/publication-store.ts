import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { Block, Release, PublishedEntry, Entry } from '@weava/contracts';
import { plain, tokens } from './documents.ts';
import { rememberPrivateMedia } from './media-policy.ts';
import { indexPublishedRevisions } from './list-index.ts';
import { publishedObjectKey, publishedMetadata, publishedHasBlocks, publishedResponsePath, publishedMedia } from './release-reader.ts';
import { publicationDependencies,entryDependencies,validationSnapshot } from './publication-validation.ts';
import { entryMediaReferences, mediaReferencesIn } from './media-references.ts';
import { referencedLayouts } from './layouts.ts';
import {BoundedCache} from './cache.ts';

const keyOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface Derivatives {media:BoundedCache<string,string[]>;search:BoundedCache<string,{key:string;text:string}>}
const derivatives=new WeakMap<object,Derivatives>();
function derivativeCache(db:Database.Database){let cache=derivatives.get(db);if(!cache){cache={media:new BoundedCache(20000,8*1024*1024),search:new BoundedCache(20000,16*1024*1024)};derivatives.set(db,cache);}return cache;}

// Index a page's own authored text, not every article displayed in a dynamic list.
export function blockText(blocks: Block[],entry?:Entry,release?:Release,seen=new Set<string>()): string {
  return blocks.map((block) => {
    const p = {...block.props};
    for(const [key,binding] of Object.entries(block.bindings??{})){const source=binding.source==='site'?release?.settings:binding.source==='field'?entry?.fields:entry;if(source&&Object.hasOwn(source,binding.key))p[key]=(source as any)[binding.key];}
    let own = '';
    if (['text', 'richtext', 'hero', 'image-text', 'callout'].includes(block.type))
      own = [p.eyebrow, p.title, p.description, p.text, p.buttonLabel].filter((value) => typeof value === 'string').join(' ');
    if (['image', 'video'].includes(block.type)) own = [p.alt, p.caption].filter(Boolean).join(' ');
    if (block.type === 'gallery' && Array.isArray(p.images)) own = p.images.map((image) => typeof image === 'string' ? '' : [image.alt, image.caption].filter(Boolean).join(' ')).join(' ');
    if (block.type === 'faq' && Array.isArray(p.items)) own = p.items.map((item) => item.question + ' ' + item.answer).join(' ');
    if (['button', 'attachment'].includes(block.type)) own = String(p.label ?? '');
    if (block.type === 'compatibility') own = plain(String(p.html ?? ''));
    if(block.type==='shared'&&release&&!seen.has(p.layoutId)){const target=release.layouts?.find((layout)=>layout.id===p.layoutId);if(target)own=blockText(target.blocks,entry,release,new Set(seen).add(p.layoutId));}
    if (block.type === 'content-detail' && release) {
      const target = p.entryId ? release.entries.find(item => item.id === p.entryId && item.visibility !== 'private') : entry;
      if (target && !seen.has('entry:' + target.id)) own = target.blocks.length ? blockText(target.blocks,target,release,new Set(seen).add('entry:' + target.id)) : plain(target === entry ? (target as PublishedEntry).html ?? '' : (target as PublishedEntry).html);
    }
    return plain(own) + ' ' + blockText(block.children ?? [],entry,release,seen);
  }).join(' ');
}

interface Manifest {
  storageVersion: 2;
  id: string;
  createdAt: string;
  label: string;
  entryKeys: string[];
  settingsKey: string;
  typesKey: string;
  redirectsKey: string;
  termsKey?: string;
  layoutsKey?: string;
  catalogKey?: string;
}
/** Serialize, hash and derive indexes before taking the publication write lock. */
export function prepareReleaseStorage(db: Database.Database, release: Release) {
  const cache=derivativeCache(db);
  const objects = new Map<string, {kind:string;data:string}>();
  const object = (_db: Database.Database, kind: string, value: unknown) => {
    const data=JSON.stringify(value),key=createHash('sha256').update('{"kind":'+JSON.stringify(kind)+',"value":'+data+'}').digest('hex');
    objects.set(key,{kind,data});return key;
  };
  const manifest: Manifest = { storageVersion: 2, id: release.id, createdAt: release.createdAt, label: release.label,
    entryKeys: [], settingsKey: object(db, 'settings', release.settings), typesKey: object(db, 'types', release.types),
    redirectsKey: object(db, 'redirects', release.redirects ?? {}), termsKey: object(db, 'terms', release.terms ?? []),
    layoutsKey: object(db, 'layouts', release.layouts ?? []) };
  const members:{entryId:string;position:number;searchKey:string;searchText:string;indexable:boolean}[]=[];
  const sources:{entryKey:string;dependencyKey:string;searchKey:string}[]=[];
  const media:{entryId:string;paths:Set<string>;private:boolean}[]=[];
  const catalog:any[]=[];
  const layoutKeys=new WeakMap<object,string>();
  const hasSourceCache=!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='publication_search_sources'").get();
  const sourceLookup=hasSourceCache?db.prepare('SELECT s.search_key FROM publication_search_sources s JOIN publication_search_keys k ON k.key=s.search_key WHERE s.entry_key=? AND s.dependency_key=?'):undefined;
  for (const [position, entry] of release.entries.entries()) {
    const key = publishedObjectKey(entry) ?? object(db, 'entry', entry);
    manifest.entryKeys.push(key);
    const hasBlocks=publishedHasBlocks(entry);
    const layouts=referencedLayouts(entry,release),layoutKey=keyOf(layouts.map(layout=>{let value=layoutKeys.get(layout);if(!value){value=keyOf(layout);layoutKeys.set(layout,value);}return value;}));
    const mediaKey=key+':'+layoutKey,priorMedia=publishedMedia(entry);
    let paths=priorMedia?.layouts===layoutKey?priorMedia.paths:cache.media.get(mediaKey);
    if(!paths){paths=[...entryMediaReferences(entry,release)];cache.media.set(mediaKey,paths,mediaKey.length*2+JSON.stringify(paths).length*2);}
    catalog.push({key,summary:publishedMetadata(entry),hasBlocks,responsePath:publishedResponsePath(entry)??null,dependencies:entryDependencies(entry),validation:validationSnapshot(entry),media:{layouts:layoutKey,paths}});
    const dependencyKey=hasBlocks?keyOf([release.settings,release.layouts,publicationDependencies(entry,release)]):'';
    let searchKey=(sourceLookup?.get(key,dependencyKey) as {search_key:string}|undefined)?.search_key;
    let searchText='';
    if(!searchKey){
      const cacheKey=key+':'+dependencyKey,known=cache.search.get(cacheKey);
      if(known){searchKey=known.key;searchText=known.text;}
      else{
        searchText=tokens([entry.title,entry.description,hasBlocks?'':plain(entry.html),hasBlocks?blockText(entry.blocks,entry,release):'',entry.categories.join(' '),entry.tags.join(' ')].join(' '));
        searchKey=keyOf({kind:'search',entryKey:key,text:searchText});
        cache.search.set(cacheKey,{key:searchKey,text:searchText},cacheKey.length*2+searchText.length*2+128);
      }
      if(hasSourceCache)sources.push({entryKey:key,dependencyKey,searchKey});
    }
    members.push({entryId:entry.id,position,searchKey,searchText,indexable:entry.indexable&&entry.visibility!=='private'});
    media.push({entryId:entry.id,paths:new Set(paths),private:entry.visibility==='private'});
  }
  manifest.catalogKey=object(db,'catalog',catalog);
  return {release,objects,members,sources,media,manifest:JSON.stringify(manifest),globalMedia:mediaReferencesIn([release.settings,referencedLayouts(undefined,release)])};
}
export function writeReleaseStorage(db: Database.Database, prepared:ReturnType<typeof prepareReleaseStorage>, updateExisting=false){
  const {release,objects,members,sources,media,manifest,globalMedia}=prepared;
  const insert=db.prepare('INSERT OR IGNORE INTO publication_objects(key,kind,data) VALUES(?,?,?)');
  for(const [key,{kind,data}] of objects)insert.run(key,kind,data);
  if(sources.length){const source=db.prepare('INSERT OR REPLACE INTO publication_search_sources VALUES(?,?,?)');for(const row of sources)source.run(row.entryKey,row.dependencyKey,row.searchKey);}
  const member=db.prepare('INSERT INTO publication_members(release_id,object_key,entry_id,position) VALUES(?,?,?,?)'),indexed=db.prepare('INSERT OR IGNORE INTO publication_search_keys(key) VALUES(?)'),fts=db.prepare('INSERT INTO publication_fts(object_key,tokens) VALUES(?,?)');
  for(const row of members){member.run(release.id,row.searchKey,row.entryId,row.position);if(row.indexable&&indexed.run(row.searchKey).changes)fts.run(row.searchKey,row.searchText);}
  if(updateExisting)db.prepare('UPDATE releases SET data=? WHERE id=?').run(manifest,release.id);
  else db.prepare('INSERT INTO releases VALUES(?,?,?)').run(release.id,manifest,release.createdAt);
  const pub=db.prepare('INSERT OR IGNORE INTO public_media_paths VALUES(?,?)');
  const refs=db.prepare("SELECT 1 FROM sqlite_master WHERE name='publication_entry_media'").get()?db.prepare('INSERT OR IGNORE INTO publication_entry_media VALUES(?,?,?)'):undefined;
  for(const row of media){if(row.private)rememberPrivateMedia(db,row.paths);else for(const path of row.paths)pub.run(release.id,path);for(const path of row.paths)refs?.run(release.id,row.entryId,path);}
  for(const path of globalMedia)pub.run(release.id,path);
  indexPublishedRevisions(db,release);
}
export function storeRelease(db: Database.Database, release: Release, updateExisting = false) {
  writeReleaseStorage(db,prepareReleaseStorage(db,release),updateExisting);
}
export { loadRelease } from './release-reader.ts';

export function searchRelease(db: Database.Database, release: Release, query: string) {
  const terms = tokens(query).split(' ').filter(Boolean);
  if (!terms.length) return [];
  const match = terms.map((term) => '"' + term.replaceAll('"', '') + '"').join(' AND ');
  const found = db.transaction(()=>{
    if(!db.prepare('SELECT 1 FROM releases WHERE id=?').get(release.id)){
      // An in-flight reader may still hold a release whose database indexes were archived.
      const index=new Database(':memory:');
      try{
        index.exec("CREATE VIRTUAL TABLE search USING fts5(id UNINDEXED,position UNINDEXED,tokens,tokenize='unicode61')");
        const insert=index.prepare('INSERT INTO search VALUES(?,?,?)');
        for(const [position,entry] of release.entries.entries())if(entry.indexable&&entry.visibility!=='private')insert.run(entry.id,position,tokens([entry.title,entry.description,publishedHasBlocks(entry)?blockText(entry.blocks,entry,release):plain(entry.html),entry.categories.join(' '),entry.tags.join(' ')].join(' ')));
        return index.prepare('SELECT id FROM search WHERE search MATCH ? ORDER BY rank,position').all(match) as {id:string}[];
      }finally{index.close();}
    }
    return db.prepare(`SELECT m.entry_id id FROM publication_fts f JOIN publication_members m ON m.object_key=f.object_key
    WHERE publication_fts MATCH ? AND m.release_id=? ORDER BY rank,m.position`).all(match, release.id) as { id: string }[];
  })();
  const entries = new Map(release.entries.filter((entry) => entry.visibility !== 'private' && entry.indexable).map((entry) => [entry.id, entry]));
  return found.flatMap(({ id }) => {
    const entry = entries.get(id);
    return entry ? [{ id, path: entry.path, title: entry.title, description: entry.description }] : [];
  });
}
