import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { Site, uploadMedia } from '@weava/core';
import { entrySchema } from '@weava/contracts';

const output = 'D:/Tools/cache/weava/privacy-browser-' + Date.now();
const root = join(output,'site'), framework = resolve(import.meta.dirname,'..');
const port = process.env.WEAVA_TEST_PORT ?? '45322', base = 'http://127.0.0.1:' + port;
mkdirSync(output,{recursive:true});
const password=randomBytes(20).toString('hex');
const site=new Site(root);
site.saveType({id:'post',label:'文章',fields:[],pathPrefix:'/posts/',template:'article'},null);
site.setOwner(password);
const photo=await uploadMedia(site,await sharp({create:{width:1200,height:700,channels:3,background:'#315c4c'}}).png().toBuffer(),'private.png');
const secret=site.saveEntry(entrySchema.parse({id:'secret',kind:'content',title:'私密验证文章',path:'/secret/',visibility:'private',status:'published',cover:photo.value.url,
  document:{version:1,format:'markdown',source:'只有站主可以查看的正文。'}}),null);
site.saveEntry(entrySchema.parse({id:'public',kind:'content',title:'公开验证文章',path:'/',status:'published',blocks:[{id:'all',type:'content-list',props:{}}]}),null);
site.publish();
const protectedUrls=[photo.value.url,...photo.value.derivatives.map((d:any)=>d.url)];
site.close();
const child=spawn(process.execPath,[join(framework,'apps/web/dist/server/entry.mjs')],{
  cwd:framework,windowsHide:true,env:{...process.env,WEAVA_SITE:root,WEAVA_FRAMEWORK:framework,PORT:port,HOST:'127.0.0.1',ASTRO_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
});
let log='';child.stdout?.on('data',(data)=>log+=data);child.stderr?.on('data',(data)=>log+=data);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  for(let i=0;i<100;i++) {
    try { if((await fetch(base+'/__health')).ok)break; } catch {}
    if(i===99)throw new Error('Fixture did not start: '+log);
    await new Promise((resolve)=>setTimeout(resolve,100));
  }
  browser=await chromium.launch({channel:'chrome',headless:true});
  const owner=await browser.newContext({viewport:{width:1440,height:1000}});
  const visitor=await browser.newContext();
  const page=await owner.newPage();
  const errors:string[]=[];page.on('pageerror',(err)=>errors.push(err.message));
  const hidden=async()=>{
    assert.equal((await visitor.request.get(base+'/secret/')).status(),404);
    for(const url of protectedUrls)assert.equal((await visitor.request.get(base+url)).status(),404,url);
    for(const path of ['/','/api/v1/content','/api/v1/search?q='+encodeURIComponent('私密验证文章'),'/rss.xml','/sitemap.xml']) {
      const response=await visitor.request.get(base+path);assert.equal(response.status(),200);
      assert(!(await response.text()).includes('私密验证文章'),path);
    }
  };
  await hidden();
  await page.goto(base+'/admin/');
  await page.getByLabel('站主密码').fill(password);
  await page.getByRole('button',{name:'进入网站',exact:true}).click();
  await page.getByRole('button').filter({hasText:'私密验证文章'}).click();
  assert.equal(await page.getByLabel('文章可见性').inputValue(),'private');
  const restricted=await owner.request.get(base+'/secret/');
  assert.equal(restricted.status(),200);
  assert.match(restricted.headers()['cache-control'],/private.*no-store/);
  assert.equal(restricted.headers()['x-robots-tag'],'noindex, nofollow');
  assert(!(await restricted.text()).includes('weava-analytics.js'));
  for(const url of protectedUrls) {
    const response=await owner.request.get(base+url);assert.equal(response.status(),200);
    assert.match(response.headers()['cache-control'],/private.*no-store/);
  }
  await page.screenshot({path:join(output,'private-controls.png')});
  await page.getByLabel('文章可见性').selectOption('public');
  await page.getByRole('button',{name:'发布',exact:true}).click();
  await page.getByText('操作已完成',{exact:true}).waitFor();
  assert.equal((await visitor.request.get(base+'/secret/')).status(),200);
  assert.equal((await visitor.request.get(base+photo.value.url)).status(),200);
  await page.getByLabel('文章可见性').selectOption('private');
  await page.getByRole('button',{name:'发布',exact:true}).click();
  for (let attempt=0;attempt<100;attempt++) {
    const jobs=await (await owner.request.get(base+'/api/admin/v1/jobs')).json();
    if(jobs.length>=2 && jobs[0].status==='complete')break;
    assert(attempt<99,'Second publication did not finish');
    await new Promise((resolve)=>setTimeout(resolve,100));
  }
  await hidden();
  await page.locator('.sidebar').getByRole('button',{name:'退出',exact:true}).click();
  await page.getByLabel('站主密码').waitFor();
  assert.equal((await owner.request.get(base+'/secret/')).status(),404);
  assert.equal((await owner.request.get(base+photo.value.url)).status(),404);
  await page.goto(base+'/');
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:join(output,'fixture-mobile.png')});
  assert.equal(errors.length,0,errors.join('\n'));
  const report={passed:true,privatePageAndMedia:true,publicSurfacesFiltered:true,visibilityTransitions:true,logoutRevokesAccess:true,mobileNoOverflow:true,errors,output};
  writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} catch(error:any) {
  writeFileSync(join(output,'failure.json'),JSON.stringify({error:error.message,log},null,2));throw error;
} finally {await browser?.close();child.kill();writeFileSync(join(output,'server.log'),log);}
