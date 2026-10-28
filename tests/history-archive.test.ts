import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Site, planHistoryArchive, archiveHistory, restoreHistoryArchive, verifyHistoryArchive, historyArchiveContents, historyArchives, compactDatabase, schedulePublication } from '@weava/core';
import { entrySchema } from '@weava/contracts';
const base = 'D:/Tools/cache/weava/tests/history-archive-' + Date.now(), sites: Site[] = []; let sequence = 0;
const create = () => { const site = new Site(base + '/' + sequence++); sites.push(site); return site; };
const options = { before:'2099-01-01T00:00:00Z',keepReleases:1,keepRevisions:1 };
const seed = (site: Site) => {
  const releases: string[] = [], revisions: number[] = [];
  let row = site.saveEntry(entrySchema.parse({id:'page',kind:'page',title:'页面 0',path:'/page/',status:'published',blocks:[{id:'text',type:'text',props:{text:'第 0 版正文'}}]}),null);
  revisions.push(row.revision); releases.push(site.publish().id);
  for(let index=1;index<6;index++){row=site.saveEntry({...row.value,title:'页面 '+index,blocks:[{id:'text',type:'text',props:{text:'第 '+index+' 版正文'}}]},row.revision);revisions.push(row.revision);releases.push(site.publish().id);}
  return {releases,revisions,row};
};
afterEach(() => sites.splice(0).forEach((site) => site.close()));
describe('reversible history maintenance',()=>{
  it('protects current content, the active release, retained history and scheduled revisions before archival',async()=>{
    const site=create(),{releases,revisions,row}=seed(site);
    const scheduled=schedulePublication(site,row.id,row.revision,new Date(Date.now()+60000).toISOString());
    const changed=site.saveEntry({...row.value,title:'计划之后的工作稿'},row.revision);
    const plan=planHistoryArchive(site,options);expect(plan.releaseIds).toEqual(expect.arrayContaining(releases.slice(0,-1)));expect(plan.releaseIds).not.toContain(releases.at(-1));expect(plan.revisions).not.toContain(scheduled.value.entryRevision);expect(plan.revisions).not.toContain(changed.revision);
    const archived=await archiveHistory(site,options,plan.review);expect(archived.archived).toBe(true);expect(site.release()!.id).toBe(releases.at(-1));expect(site.store.get('entry','page')!.revision).toBe(changed.revision);expect(site.history('page').map((row)=>row.revision)).toContain(scheduled.value.entryRevision);
    expect(site.release(releases[0])).toBeNull();expect(()=>site.rollback(releases[0])).toThrow(/不存在/);
    const listed=historyArchiveContents(site,archived.id!);expect(listed.revisions.map((row)=>row.revision)).toContain(revisions[0]);expect(listed.releases.map((row)=>row.id)).toContain(releases[0]);
  });
  it('verifies and restores archived immutable versions without changing current workdrafts or public state',async()=>{
    const site=create(),{releases,row}=seed(site),before=site.release()!,plan=planHistoryArchive(site,options),archived=await archiveHistory(site,options,plan.review);
    expect(site.search('第 5 版正文')).toHaveLength(1);expect(verifyHistoryArchive(site,archived.id!).manifest.version).toBe(1);
    const restored=restoreHistoryArchive(site,archived.id!);expect(restored.restoredReleases).toBe(5);expect(site.store.get('entry','page')!.revision).toBe(row.revision);expect(site.release()!.id).toBe(before.id);
    expect(restoreHistoryArchive(site,archived.id!)).toMatchObject({restoredReleases:0,restoredRevisions:0});
    site.rollback(releases[0]);expect(site.search('第 0 版正文')).toHaveLength(1);expect(site.release()!.entries[0].title).toBe('页面 0');
  });
  it('rejects stale preflight and damaged archive files without removing active history',async()=>{
    const site=create(),{row}=seed(site),plan=planHistoryArchive(site,options);site.saveEntry({...row.value,title:'预检后的修改'},row.revision);
    await expect(archiveHistory(site,options,plan.review)).rejects.toThrow(/重新预检/);expect(site.releases()).toHaveLength(6);
    const next=planHistoryArchive(site,options),archived=await archiveHistory(site,options,next.review),path=join(archived.path!,'objects.jsonl'),original=readFileSync(path);writeFileSync(path,original.toString()+'damaged');
    expect(()=>restoreHistoryArchive(site,archived.id!)).toThrow(/校验失败/);expect(site.releases()).toHaveLength(1);writeFileSync(path,original);expect(verifyHistoryArchive(site,archived.id!).manifest.id).toBe(archived.id);
  });
  it('keeps privacy of archived private media and compacts only after creating a readable database copy',async()=>{
    const site=create();let row=site.saveEntry(entrySchema.parse({id:'page',kind:'page',title:'私密旧稿',path:'/private/',visibility:'private',cover:'/media/private-old.png'}),null);
    for(let index=0;index<4;index++) row=site.saveEntry({...row.value,title:'新稿 '+index,cover:''},row.revision);
    const plan=planHistoryArchive(site,options),archive=await archiveHistory(site,options,plan.review);expect(site.isPrivateMedia('/media/private-old.png')).toBe(true);expect(historyArchives(site)).toHaveLength(1);
    const result=await compactDatabase(site);expect(result.integrity).toBe('ok');expect(readFileSync(result.backup).subarray(0,15).toString()).toBe('SQLite format 3');expect(verifyHistoryArchive(site,archive.id!).manifest.version).toBe(1);
  });
});
