import {expect,it} from 'vitest';
import {join} from 'node:path';
import {Storage} from '../packages/core/src/storage.ts';
import {Engagement} from '../packages/core/src/engagement.ts';
import {assertRequestOrigin,assertJsonRequest} from '../packages/core/src/request-safety.ts';
import {publicAddress,publicAttachmentTarget,downloadPublicAttachment} from '../packages/core/src/attachment-download.ts';
import {validateMediaFormat} from '../packages/core/src/media-format.ts';
import {blockSchema} from '@weava/contracts';
import {builtInLayouts,copyPattern} from '../packages/core/src/layouts.ts';
import {adminPanel,panelUrl} from '../apps/admin/src/admin-location.ts';

it('keeps admin addresses valid and preserves unrelated URL parameters',()=>{
  expect(adminPanel('?panel=account')).toBe('account');expect(adminPanel('?panel=invalid')).toBe('content');
  expect(panelUrl('http://localhost/admin/?debug=1','media')).toBe('/admin/?debug=1&panel=media');
  expect(panelUrl('http://localhost/admin/?panel=media','content')).toBe('/admin/');
});
it('offers blog, portfolio and docs patterns with independent block identities and bounded typography',()=>{
  for(const [id,type]of [['blog-index','post'],['portfolio-index','project'],['docs-index','doc']]){
    const pattern=builtInLayouts.find(layout=>layout.id===id)!;expect(pattern.kind).toBe('pattern');
    expect(pattern.blocks.some(block=>block.props.contentType===type)).toBe(true);
    const copy=copyPattern(pattern);expect(copy[0].id).not.toBe(pattern.blocks[0].id);
  }
  expect(blockSchema.safeParse({id:'text',type:'text',props:{},style:{fontSize:16,headingSize:36,textColor:'#223344'}}).success).toBe(true);
  expect(blockSchema.safeParse({id:'text',type:'text',props:{},style:{fontSize:2}}).success).toBe(false);
});
it('preserves reply identities through paging and moderation without exposing hidden parents',async()=>{
  const store=new Storage(join('D:/Tools/cache/weava/tests/personal-'+Date.now(),'comments'));
  try{
    let time=Date.now();const engagement=new Engagement(store.raw,'secret',{clock:()=>time,code:()=>'A2BCD'}),reader='a'.repeat(64);
    const challenge=await engagement.createCaptcha(reader,'ip');
    const parent=engagement.postComment('post',reader,'ip',{author:'读者',body:'原评论',captchaId:challenge.id,captcha:'A2BCD',clientId:'first-comment-123'});
    const reply=engagement.replyAsOwner(parent.id,'站主回复','站主','owner-comment-123');
    expect(reply).toMatchObject({parentId:parent.id,replyTo:'读者',isOwner:true});
    expect(engagement.replyAsOwner(parent.id,'站主回复','站主','owner-comment-123').id).toBe(reply.id);
    time+=16000;const second=await engagement.createCaptcha(reader,'ip');
    const input={author:'站主',isOwner:true,body:'回复站主',captchaId:second.id,captcha:'A2BCD',clientId:'second-comment-123',parentId:reply.id};
    expect(engagement.postComment('post',reader,'ip',input).isOwner).toBe(false);
    expect(()=>engagement.postComment('post',reader,'ip',{...input,parentId:parent.id})).toThrow('已改变');
    expect(()=>engagement.postComment('other',reader,'ip',{...input,clientId:'wrong-parent-123'})).toThrow('不存在');
    for(let i=0;i<25;i++){time+=1000;engagement.replyAsOwner(parent.id,'回复 '+i,'站主','paged-reply-'+i);}
    const older=engagement.summary('post',undefined,2);expect(older.items.length).toBeGreaterThan(0);expect(older.items.find(item=>item.id===reply.id)?.parentId).toBe(parent.id);
    engagement.moderate(parent.id,'hidden');const visible=engagement.summary('post',undefined,2).items.find(item=>item.id===reply.id)!;
    expect(visible.replyTo).toBeNull();expect(visible.parentId).toBeNull();expect(visible.isOwner).toBe(true);
    expect(engagement.comments().items.find(item=>item.id===reply.id)?.parentId).toBe(parent.id);
    engagement.moderate(parent.id,'visible');expect(engagement.summary('post',undefined,2).items.find(item=>item.id===reply.id)?.replyTo).toBe('读者');
  }finally{store.close();}
});
it('rejects cross-site, downgraded, malformed and non-JSON browser writes',()=>{
  const request=(origin:string,extra={})=>new Request('http://site.example/api/admin/v1/login',{method:'POST',headers:{origin,...extra}});
  expect(()=>assertRequestOrigin(request('http://site.example'))).not.toThrow();
  expect(()=>assertRequestOrigin(new Request('http://localhost:4322/api/admin/v1/login',{method:'POST',headers:{host:'127.0.0.1:4322',origin:'http://127.0.0.1:4322'}}))).not.toThrow();
  for(const origin of ['null','https://evil.example','https://site.example','http://site.example/path'])expect(()=>assertRequestOrigin(request(origin))).toThrow();
  expect(()=>assertRequestOrigin(request('https://site.example'),'https:')).not.toThrow();
  expect(()=>assertRequestOrigin(request('http://site.example',{'sec-fetch-site':'cross-site'}))).toThrow();
  expect(()=>assertJsonRequest(new Request('http://site.example',{method:'POST',headers:{'content-type':'text/plain'}}))).toThrow();
});
it('blocks private and mixed DNS destinations, alternate IP spellings, credentials and unsafe protocols',async()=>{
  for(const address of ['127.0.0.1','10.0.0.1','100.64.1.1','169.254.169.254','172.16.1.1','192.168.1.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2001:0db8::1','2002:7f00:1::'])expect(publicAddress(address),address).toBe(false);
  expect(publicAddress('8.8.8.8')).toBe(true);expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  for(const url of ['http://2130706433/','http://0x7f000001/','http://[::1]/','http://localhost/','file:///etc/passwd','http://user:pass@example.com/'])await expect(publicAttachmentTarget(url)).rejects.toThrow();
  await expect(publicAttachmentTarget('https://example.com',async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}] as any)).rejects.toThrow('内网');
  await expect(downloadPublicAttachment('http://127.0.0.1/')).rejects.toThrow('内网');
});
it('rejects disguised uploads while accepting recognizable image and PDF signatures',()=>{
  for(const ext of ['.png','.jpg','.webp','.gif','.avif','.pdf','.mp4','.webm','.mp3'])expect(()=>validateMediaFormat(Buffer.from('<script>alert(1)</script>'),ext)).toThrow();
  expect(()=>validateMediaFormat(Buffer.from('%PDF-1.7\nexample'),'.pdf')).not.toThrow();
  expect(()=>validateMediaFormat(Buffer.from('89504e470d0a1a0a','hex'),'.png')).not.toThrow();
  expect(()=>validateMediaFormat(Buffer.from([65,0,66]),'.txt')).toThrow();
});
