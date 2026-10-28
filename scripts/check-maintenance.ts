import type { Page, BrowserContext } from 'playwright';
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
export async function checkMaintenance({origin,api,cli,page,context,output}:{origin:string;api:(action:string,value?:any)=>Promise<any>;cli:(args:string[])=>Promise<any>;page:Page;context:BrowserContext;output:string}){
  const entry=await api('entry/article-0'),oldHistory=await api('history?id='+entry.id),before=await fetch(origin+'/__health').then((response)=>response.json()) as any;
  await page.goto(origin+'/admin/');await page.getByRole('heading',{name:'内容',exact:true}).waitFor();
  await page.getByRole('button',{name:'运行与备份',exact:true}).click();
  await page.getByLabel('归档早于',{exact:true}).fill('2099-01-01');await page.getByLabel('至少保留公开版本',{exact:true}).fill('1');await page.getByLabel('每份内容至少保留修订',{exact:true}).fill('1');
  await page.getByRole('button',{name:'预检历史归档',exact:true}).click();await page.getByRole('button',{name:'执行已预检归档',exact:true}).waitFor();
  await page.getByRole('button',{name:'执行已预检归档',exact:true}).click();await page.getByRole('button',{name:'查看归档',exact:true}).waitFor({timeout:30000});
  const archives=await cli(['maintenance','archives']);assert.equal(archives.length,1);assert(archives[0].releases>0);assert(archives[0].revisions>0);
  const inspect=await cli(['maintenance','inspect','--id',archives[0].id]);assert(inspect.releases.length>0);
  assert.equal((await fetch(origin+'/__health').then((response)=>response.json()) as any).releaseId,before.releaseId);assert.equal((await api('entry/article-0')).revision,entry.revision);
  await page.getByRole('button',{name:'查看归档',exact:true}).click();await page.getByText('归档内容',{exact:true}).waitFor();await page.screenshot({path:join(output,'history-archive.png'),fullPage:true});
  await page.getByRole('button',{name:'恢复历史记录',exact:true}).click();await page.getByText('历史已恢复到版本列表，当前工作稿和公开页面保持原状。',{exact:true}).waitFor({timeout:30000});
  assert.equal((await api('history?id='+entry.id)).length,oldHistory.length);assert.equal((await fetch(origin+'/__health').then((response)=>response.json()) as any).releaseId,before.releaseId);
  const visitor=await context.newPage();await visitor.goto(origin+'/posts/0/');await visitor.getByRole('heading',{name:'未发布的文章改稿',exact:true}).waitFor();await visitor.close();
  return {browserPreflight:true,compiledWorkerArchive:true,cliInspection:true,restoredHistory:true,currentDraftPreserved:true,currentReleasePreserved:true};
}
