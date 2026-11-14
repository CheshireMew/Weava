import {afterEach,expect,it,vi} from 'vitest';
import {mkdirSync,writeFileSync,readFileSync,existsSync,renameSync,readdirSync} from 'node:fs';
import {join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {Site} from '../packages/core/src/site.ts';
import {Analytics} from '../packages/core/src/analytics.ts';
import {BusinessStore} from '../packages/core/src/site-sdk.ts';
import {createBackup,verifyBackup} from '../packages/core/src/backup.ts';
import {deleteMedia} from '../packages/core/src/media-deletion.ts';
const base=join(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests','backup-consistency-'+randomUUID());
const sites:Site[]=[],databases:Database.Database[]=[];let sequence=0;
function fixture(){const site=new Site(join(base,String(sequence++)));sites.push(site);writeFileSync(join(site.root,'media/file.txt'),'original');const row=site.store.put('media','file',{url:'/media/file.txt',name:'file.txt',derivatives:[]},null);return {site,row};}
afterEach(()=>{vi.restoreAllMocks();databases.splice(0).forEach(db=>db.close());sites.splice(0).forEach(site=>site.close());});
it('holds a common database snapshot while preventing concurrent deletion of its media files',async()=>{
  const {site,row}=fixture(),writer=new Site(site.root);sites.push(writer);writer.store.raw.pragma('busy_timeout=1');
  const analytics=new Analytics(site.root);analytics.close();const business=new BusinessStore(site.root,'migrate');business.put('test','value','before');business.close();
  const stats=new Database(join(site.root,'analytics.sqlite')),data=new Database(join(site.root,'business.sqlite'));databases.push(stats,data);stats.pragma('busy_timeout=1');data.pragma('busy_timeout=1');
  const original=Database.prototype.backup;let attempted=false;
  vi.spyOn(Database.prototype,'backup').mockImplementation(async function(this:Database.Database,file:string,options?:any){
    const result=await original.call(this,file,options);
    if(basename(file)==='weava.sqlite'){
      attempted=true;
      expect(()=>deleteMedia(writer,row.id,row.revision)).toThrow(/locked/);
      expect(()=>stats.prepare("UPDATE analytics_health SET last_accepted='after'").run()).toThrow(/locked/);
      expect(()=>data.prepare("UPDATE website_data SET data='\"after\"'").run()).toThrow(/locked/);
    }
    return result;
  });
  const backup=await createBackup(site,join(base,'backups'));expect(attempted).toBe(true);expect(verifyBackup(backup.path).files).toEqual(expect.arrayContaining([expect.objectContaining({path:'media/file.txt'})]));
  expect(readFileSync(join(backup.path,'media/file.txt'),'utf8')).toBe('original');
  // Reservations are released on success; normal writes resume immediately.
  expect(()=>deleteMedia(writer,row.id,row.revision)).not.toThrow();
  data.prepare("UPDATE website_data SET data='\"after\"'").run();
});
it('rejects filesystem changes outside SQLite and does not publish a success manifest',async()=>{
  const {site}=fixture();mkdirSync(join(site.root,'public'));writeFileSync(join(site.root,'public/logo.svg'),'<svg/>');
  const original=Database.prototype.backup;
  vi.spyOn(Database.prototype,'backup').mockImplementation(async function(this:Database.Database,file:string,options?:any){const result=await original.call(this,file,options);writeFileSync(join(site.root,'public/logo.svg'),'<svg>changed externally</svg>');return result;});
  const destination=join(base,'changed-backup');await expect(createBackup(site,destination)).rejects.toThrow(/文件发生变化/);
  expect(readdirSync(destination).every(name=>!existsSync(join(destination,name,'manifest.json')))).toBe(true);
  expect(()=>site.store.put('test','released',{ok:true},null)).not.toThrow();
});
it('verifies media references even when a missing file was omitted from the manifest',async()=>{
  const {site}=fixture(),backup=await createBackup(site,join(base,'verified-backups'));
  const file=join(backup.path,'manifest.json'),manifest=JSON.parse(readFileSync(file,'utf8'));
  renameSync(join(backup.path,'media/file.txt'),join(backup.path,'media/retained-fixture.txt'));
  manifest.files=manifest.files.filter((item:{path:string})=>item.path!=='media/file.txt');writeFileSync(file,JSON.stringify(manifest));
  expect(()=>verifyBackup(backup.path)).toThrow(/缺少媒体记录引用/);
});
