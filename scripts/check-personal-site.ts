import {strict as assert} from 'node:assert';
import {join,resolve} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync,existsSync,openSync,closeSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {Site,Engagement,prepareMedia} from '@weava/core';
import {entrySchema} from '@weava/contracts';
import {seedDemo} from '../packages/core/src/demo.ts';
import {totpCode} from '../packages/core/src/two-factor.ts';

const framework=resolve(import.meta.dirname,'..'),output=process.env.WEAVA_CHECK_OUTPUT??'D:/Tools/cache/weava/personal-site-'+Date.now();
const root=join(output,'site'),build=process.env.WEAVA_CHECK_BUILD??join(output,'program');mkdirSync(output,{recursive:true});
process.env.TEMP=output;process.env.TMP=output;
const portProbe=createServer();await new Promise<void>(done=>portProbe.listen(0,'127.0.0.1',done));
const port=(portProbe.address() as any).port;await new Promise<void>(done=>portProbe.close(()=>done()));
const origin='http://127.0.0.1:'+port,password=randomBytes(24).toString('hex'),newPassword=randomBytes(24).toString('hex');
const site=new Site(root);site.setOwner(password);writeFileSync(join(root,'site.json'),JSON.stringify({version:1,port}));
writeFileSync(join(root,'media','demo-landscape.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="#dce6d8"/><path d="M0 700 400 180 800 700Z" fill="#315c4c"/></svg>');
seedDemo(site);
const logo=await prepareMedia(site,await sharp({create:{width:80,height:80,channels:3,background:'#315c4c'}}).png().toBuffer(),'personal-logo.png');site.store.put('media',logo.id,logo.value,null);
const pdf=await prepareMedia(site,Buffer.from('%PDF-1.7\nexample'),'test.pdf');site.store.put('media',pdf.id,pdf.value,null);
const secret=await prepareMedia(site,Buffer.from('private attachment'),'private.txt');site.store.put('media',secret.id,secret.value,null);
site.saveEntry(entrySchema.parse({id:'private',kind:'content',type:'post',title:'Private article',path:'/private/',visibility:'private',status:'published',blocks:[{id:'private-file',type:'attachment',props:{url:secret.value.url,label:'Private attachment'}}]}),null);
const settings=site.settings();site.saveSettings({...settings.value,domain:origin,commentModeration:true},settings.revision);site.publish();
const engagement=new Engagement(site.store.raw,site.cliToken(),{code:()=>'A2BCD'}),reader='c'.repeat(64),challenge=await engagement.createCaptcha(reader,'fixture');
const comment=engagement.postComment('first-light',reader,'fixture',{author:'读者',body:'评论原文',captchaId:challenge.id,captcha:'A2BCD',clientId:'fixture-comment-123'},'visible');
const token=site.cliToken();site.close();
writeFileSync(join(root,'extensions','index.mjs'),`export default()=>({id:'acceptance',apiVersion:1,route(request){const path=new URL(request.url).pathname;if(path==='/api/test-error')throw new Error('D:/Tools/PRIVATE-SERVER-PATH');if(path==='/api/test-write'||path==='/api/admin/v1/protected-hook')return Response.json({ok:true});return null;}});`);
if(!process.env.WEAVA_CHECK_BUILD){
  const code=await new Promise<number|null>((done,fail)=>{const child=spawn(process.execPath,['--import','tsx','scripts/build.ts'],{cwd:framework,windowsHide:true,stdio:'inherit',env:{...process.env,WEAVA_BUILD_OUTPUT:build,WEAVA_SITE:root,TEMP:output,TMP:output}});child.once('error',fail);child.once('exit',done);});assert.equal(code,0,'production build');
}
const log=openSync(join(output,'server.log'),'a');
const server=spawn(process.execPath,[join(build,'web/server/entry.mjs')],{cwd:framework,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,WEAVA_SITE:root,WEAVA_FRAMEWORK:framework,WEAVA_ADMIN_DIST:join(build,'admin'),WEAVA_WORKER:join(build,'runtime/worker.mjs'),WEAVA_SOURCE_WORKER:'0',NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),TEMP:output,TMP:output}});closeSync(log);
const evidence:Record<string,any>={output,build,platform:process.platform,checks:{}};let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;let inspected:import('playwright').Page|undefined;const errors:string[]=[];
async function api(action:string,body?:any){const response=await fetch(origin+'/api/admin/v1/'+action,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json() as any;assert(response.ok,JSON.stringify(value));return value;}
async function publish(body:any){let job=await api('publish',body);const end=Date.now()+30000;while(['queued','running'].includes(job.status)&&Date.now()<end){await new Promise(done=>setTimeout(done,150));job=await api('job/'+job.id);}assert.equal(job.status,'complete',job.message);}
try{
  let ready=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw new Error('Server exited; see '+join(output,'server.log'));try{if((await fetch(origin+'/__health')).ok){ready=true;break;}}catch{}await new Promise(done=>setTimeout(done,150));}assert(ready);
  const health=await fetch(origin+'/__health').then(response=>response.json()) as any;assert.equal(health.site,undefined);assert.equal(health.pid,undefined);
  for(const path of ['/api/admin/v1/login','/api/test-write'])for(const originHeader of ['https://evil.example',origin.replace('http:','https:'),'null'])assert.equal((await fetch(origin+path,{method:'POST',headers:{Origin:originHeader,'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(origin+'/api/admin/v1/protected-hook')).status,401);
  assert.equal((await fetch(origin+'/api/admin/v1/login',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
  const internal=await fetch(origin+'/api/test-error');assert.equal(internal.status,500);assert(!(await internal.text()).includes('PRIVATE-SERVER-PATH'));
  assert((await fetch(origin+'/media/demo-landscape.svg')).headers.get('content-security-policy')?.includes('sandbox'));
  assert.equal((await fetch(origin+pdf.value.url)).headers.get('content-disposition'),'attachment');
  assert.equal((await fetch(origin+'/private/')).status,404);assert.equal((await fetch(origin+secret.value.url)).status,404);
  const badUpload=await fetch(origin+'/api/admin/v1/media',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name:'fake.png',base64:Buffer.from('<script>bad</script>').toString('base64')})});assert.equal(badUpload.status,400);
  evidence.checks.security={crossOriginAndProtocolRejected:true,extensionAuthEnforced:true,publicHealthRedacted:true,errorsRedacted:true,activeMediaIsolated:true,privateArticleAndMediaHidden:true,disguisedUploadRejected:true};
  browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
  inspected=page;
  page.on('response',async response=>{
    if(!response.url().endsWith('/api/admin/v1/login'))return;
    try { console.log(JSON.stringify({loginStatus:response.status(),error:response.ok()?undefined:(await response.json()).error})); }
    catch { console.log(JSON.stringify({loginStatus:response.status()})); }
  });
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/Content Security Policy|Refused to/.test(message.text()))errors.push(message.text());});
  await page.goto(origin+'/admin/');await page.getByLabel('站主密码',{exact:true}).fill(password);await page.getByRole('button',{name:'进入网站',exact:true}).click();await page.getByRole('navigation',{name:'网站管理'}).waitFor();
  await page.getByRole('button',{name:'媒体',exact:true}).click();await page.waitForURL('**/admin/?panel=media');await page.getByRole('button',{name:'账户',exact:true}).click();await page.waitForURL('**/admin/?panel=account');
  await page.goBack();await page.waitForURL('**/admin/?panel=media');await page.reload();await page.getByRole('heading',{name:'媒体',exact:true}).waitFor();await page.goForward();await page.waitForURL('**/admin/?panel=account');await page.getByRole('heading',{name:'站主账户',exact:true}).waitFor();
  await page.getByRole('button',{name:'外观与导航',exact:true}).click();await page.getByRole('button',{name:'选择图片',exact:true}).click();await page.getByRole('dialog',{name:'选择媒体'}).getByRole('button',{name:'personal-logo.png'}).click();
  assert.equal(await page.getByLabel('Logo 地址').inputValue(),logo.value.url);
  await page.getByRole('button',{name:'账户',exact:true}).click();assert.equal((await api('settings')).value.logo,logo.value.url);
  await page.getByLabel('显示名',{exact:true}).fill('Nico');await page.getByLabel('当前密码',{exact:true}).fill(password);await page.getByRole('button',{name:'保存账户',exact:true}).click();await page.getByText('账户资料已保存。',{exact:true}).waitFor();
  await page.screenshot({path:join(output,'account-desktop.png'),fullPage:true});evidence.checks.P01={refreshBackAndForward:true,leavingSettingsSaves:true};
  await page.getByRole('button',{name:'布局',exact:true}).click();await page.getByLabel('布局种类').selectOption('pattern');for(const name of ['博客列表','作品集','文档入口'])await page.getByRole('button',{name,exact:true}).waitFor();
  await page.getByRole('button',{name:'博客列表',exact:true}).click();await page.getByRole('button',{name:'主视觉',exact:false}).first().click();
  await page.frameLocator('iframe[title="页面画布"]').getByRole('heading',{name:'文章',exact:true}).waitFor();
  await page.locator('.block-properties details summary').filter({hasText:'布局'}).click();await page.getByLabel('正文字号',{exact:true}).fill('18');await page.getByLabel('标题字号',{exact:true}).fill('38');await page.getByRole('button',{name:'保存布局',exact:true}).click();
  const pattern=(await api('layouts')).find((row:any)=>row.id==='blog-index');assert.equal(pattern.value.blocks[0].style.headingSize,38);
  const home=await api('entry/home');home.value.blocks[0].style={fontSize:18,headingSize:38,textColor:'#345644'};await api('entry',{value:home.value,revision:home.revision});await publish({scope:'all'});
  const publicPage=await context.newPage();publicPage.on('pageerror',error=>errors.push(error.message));await publicPage.goto(origin+'/');
  assert.equal(await publicPage.locator('.hero h1').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)),38);
  assert.equal(await publicPage.locator('.hero p').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)),18);
  const card=await publicPage.locator('.card h3').first().boundingBox();assert(card&&card.y+card.height<900);await publicPage.screenshot({path:join(output,'home-desktop.png'),fullPage:true});
  for(const path of ['/work/','/docs/','/docs/getting-started/']){const response=await publicPage.goto(origin+path);assert.equal(response?.status(),200);assert.equal(await publicPage.locator('main h1').count(),1);}
  evidence.checks.P02={patternsVisibleAndSaved:true,typographyPublished:true,logoPickerSaved:true,portfolioAndDocsRender:true,firstCardInViewport:true,sameOriginCanvasRendered:true};
  if(process.env.WEAVA_CHECK_CANVAS_ONLY)evidence.scope='P01, P02 and same-origin canvas with security headers';
  else {
  await page.getByRole('button',{name:'评论',exact:true}).click();const row=page.locator('.admin-comment').filter({hasText:'评论原文'});await row.getByRole('button',{name:'回复',exact:true}).click();await row.getByLabel('回复 读者').fill('来自站主的正式回复');await row.getByRole('button',{name:'发布回复',exact:true}).click();await page.getByText('来自站主的正式回复',{exact:true}).waitFor();
  await publicPage.goto(origin+'/blog/first-light/');await publicPage.getByText('来自站主的正式回复',{exact:true}).waitFor();const ownerComment=publicPage.locator('.nl-comment').filter({hasText:'来自站主的正式回复'});await ownerComment.locator('.comment-owner').waitFor();assert.equal(await ownerComment.locator('strong').textContent(),'Nico');
  await publicPage.getByRole('button',{name:'回复',exact:true}).first().click();await publicPage.getByLabel('称呼',{exact:true}).fill('Nico · 站主');await publicPage.getByLabel('评论内容',{exact:true}).fill('访客的真实页面回复');
  await publicPage.locator('[data-captcha-image]').waitFor({state:'visible'});await publicPage.locator('[data-captcha-image]').screenshot({path:join(output,'captcha.png')});console.log(JSON.stringify({stage:'captcha-needed',output}));
  const answer=join(output,'captcha-answer.txt'),deadline=Date.now()+180000;while(!existsSync(answer)&&Date.now()<deadline)await new Promise(done=>setTimeout(done,250));assert(existsSync(answer),'Captcha answer not supplied');
  await publicPage.getByLabel('验证码',{exact:true}).fill(readFileSync(answer,'utf8').trim());await publicPage.getByRole('button',{name:'发布评论',exact:true}).click();await publicPage.getByText('评论已提交，等待审核',{exact:true}).waitFor();
  await page.reload();const pending=page.locator('.admin-comment').filter({hasText:'访客的真实页面回复'});await pending.getByRole('button',{name:'通过审核',exact:true}).click();
  await publicPage.reload();await publicPage.getByText('访客的真实页面回复',{exact:true}).waitFor();assert.equal(await publicPage.locator('.nl-comment').filter({hasText:'访客的真实页面回复'}).locator('.comment-owner').count(),0);
  const currentSettings=await api('settings');await api('settings',{revision:currentSettings.revision,value:{...currentSettings.value,theme:'newsletter'}});await publish({scope:'settings'});
  await publicPage.reload();await publicPage.getByText('来自站主的正式回复',{exact:true}).waitFor();await publicPage.getByText('访客的真实页面回复',{exact:true}).waitFor();
  await publicPage.screenshot({path:join(output,'newsletter-comments.png'),fullPage:true});evidence.checks.P03={ownerReplyOnBothThemes:true,visitorReplySubmittedWithRealCaptcha:true,moderationPreservesRelationship:true,visitorNameCannotGrantOwnerBadge:true};
  const other=await browser.newContext();assert((await other.request.post(origin+'/api/admin/v1/login',{data:{password}})).ok());
  await page.getByRole('button',{name:'账户',exact:true}).click();await page.getByLabel('当前密码',{exact:true}).fill(password);
  const revoked=page.waitForResponse(response=>response.url().endsWith('/account/sessions/revoke'));await page.getByRole('button',{name:'退出其他会话',exact:true}).click();assert((await revoked).ok());assert.equal((await other.request.get(origin+'/api/admin/v1/session').then(response=>response.json())).authenticated,false);await other.close();
  const oldCookie=(await context.cookies()).find(cookie=>cookie.name==='weava-session')!.value;
  await page.getByLabel('账户名',{exact:true}).fill('nico');await page.getByLabel('新密码',{exact:true}).fill(newPassword);await page.getByLabel('确认新密码',{exact:true}).fill(newPassword);await page.getByLabel('当前密码',{exact:true}).fill(password);await page.getByRole('button',{name:'保存账户',exact:true}).click();
  await page.getByRole('button',{name:'进入网站',exact:true}).waitFor();assert.equal((await fetch(origin+'/api/admin/v1/session',{headers:{Cookie:'weava-session='+oldCookie}}).then(response=>response.json()) as any).authenticated,false);
  await page.getByLabel('账户名',{exact:true}).fill('nico');await page.getByLabel('站主密码',{exact:true}).fill(newPassword);await page.getByRole('button',{name:'进入网站',exact:true}).click();await page.getByLabel('当前密码',{exact:true}).fill(newPassword);
  await page.getByRole('button',{name:'设置两步验证',exact:true}).click();const setupSecret=await page.getByLabel('验证器密钥',{exact:true}).inputValue();await page.getByLabel('6 位验证码',{exact:true}).fill(totpCode(setupSecret));await page.getByRole('button',{name:'确认启用',exact:true}).click();
  const recovery=(await page.locator('.recovery-codes').textContent())!.trim().split('\n');assert.equal(recovery.length,10);await page.getByRole('button',{name:'已保存，重新登录',exact:true}).click();
  await page.getByLabel('账户名',{exact:true}).fill('nico');await page.getByLabel('站主密码',{exact:true}).fill(newPassword);await page.getByLabel('验证码或恢复码（如已开启）',{exact:true}).fill(recovery[0]);await page.getByRole('button',{name:'进入网站',exact:true}).click();await page.getByRole('heading',{name:'站主账户',exact:true}).waitFor();
  await page.request.post(origin+'/api/admin/v1/logout',{data:{}});await page.getByRole('button',{name:'退出其他会话',exact:true}).isVisible();await page.getByRole('button',{name:'媒体',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'重新登录',exact:true});await dialog.waitFor();await dialog.getByLabel('站主密码',{exact:true}).fill(newPassword);await dialog.getByLabel('验证码或恢复码（如已开启）',{exact:true}).fill(recovery[1]);await dialog.getByRole('button',{name:'重新登录',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.getByText('已启用，还剩 8 个恢复码。',{exact:true}).waitFor();assert.equal(await page.locator('.account-session').count(),1);
  evidence.checks.A01={profileAndPasswordChangedInBrowser:true,oldCookieInvalidated:true,otherSessionRevokedInBrowser:true};evidence.checks.A02={setupConfirmed:true,recoveryCodesShownOnce:true,recoveryLoginAndReauthentication:true};
  await page.getByRole('button',{name:'账户',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(output,'account-mobile.png'),fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await publicPage.setViewportSize({width:390,height:844});await publicPage.reload();assert(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  evidence.browserErrors=errors;assert.deepEqual(errors,[]);evidence.passed=true;
}catch(error){evidence.passed=false;evidence.error=String(error);evidence.browserErrors=errors;if(inspected){await inspected.screenshot({path:join(output,'failure.png'),fullPage:true});evidence.visibleAlerts=await inspected.getByRole('alert').allTextContents();}throw error;}
finally{writeFileSync(join(output,'results.json'),JSON.stringify(evidence,null,2));await browser?.close();if(server.exitCode===null){server.kill();await new Promise<void>(done=>{server.once('exit',()=>done());setTimeout(done,5000).unref();});}console.log(JSON.stringify({output,passed:evidence.passed,error:evidence.error}));}
