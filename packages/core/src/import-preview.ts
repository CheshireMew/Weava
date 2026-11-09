import {join} from 'node:path';
import {Site} from './site.ts';

/** Run the real domain checks against a reusable copy of current authored rows.
 * The live database is read through WAL; history, media and dependencies are never copied.
 */
export function previewImport<T>(source:Site,action:(preview:Site)=>T):T {
  source.store.assertTask();
  const preview=new Site(join(source.root,'cache','import-preview'));
  const db=preview.store.raw;
  try{
    db.prepare('ATTACH DATABASE ? AS live').run(join(source.root,'weava.sqlite'));
    try{
      db.transaction(()=>{
        db.exec("DELETE FROM records;DELETE FROM revisions;DELETE FROM entry_list;DELETE FROM published_entry_revisions;DELETE FROM state WHERE key IN ('release','owner-admin-path','owner-retired-admin-paths');");
        db.exec("INSERT INTO records SELECT * FROM live.records WHERE scope IN ('entry','settings','type','term','layout','content-view','creation-template','writing-snippet','redirect','extension-block');INSERT INTO entry_list SELECT * FROM live.entry_list;INSERT INTO published_entry_revisions SELECT * FROM live.published_entry_revisions WHERE release_id=(SELECT value FROM live.state WHERE key='release');INSERT OR REPLACE INTO state SELECT * FROM live.state WHERE key IN ('release','owner-admin-path','owner-retired-admin-paths');DELETE FROM sqlite_sequence WHERE name='revisions';INSERT INTO sqlite_sequence(name,seq) SELECT 'revisions',COALESCE(MAX(revision),0) FROM live.revisions;");
      }).deferred();
    }finally{db.exec('DETACH DATABASE live');}
    preview.extensionBlockDefinitions=source.extensionBlockDefinitions;preview.fieldWidgets=source.fieldWidgets;
    const result=action(preview);source.store.assertTask();return result;
  }finally{preview.close();}
}
