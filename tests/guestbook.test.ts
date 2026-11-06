import { expect, it } from 'vitest';
import { Site } from '../packages/core/src/site.ts';
import { Engagement } from '../packages/core/src/engagement.ts';
import { entrySchema, supportsDiscussion } from '@weava/contracts';
import { publicApi } from '../apps/web/src/api/public.ts';

it('uses native comments, replies and comment likes on guestbook pages without enabling ordinary archive pages', async () => {
  const site=new Site('D:/Tools/cache/weava/tasks/guestbook-comments-20261106/api-fixture-'+Date.now());
  try {
    site.saveSettings({...site.settings().value,domain:'http://127.0.0.1:4330',commentModeration:false},site.settings().revision);
    site.saveType({id:'post',label:'文章',pathPrefix:'/posts/',template:'article',fields:[]},null);
    for(const value of [{id:'guestbook',kind:'page',template:'guestbook',path:'/message/'},{id:'archive',kind:'page',template:'page',path:'/archive/'},{id:'post',kind:'content',template:'article',path:'/post/'}]){
      site.saveEntry(entrySchema.parse({...value,title:value.id,status:'published'}),site.store.get('entry',value.id)?.revision??null);
    }
    site.publish();
    let now=Date.now();
    const engagement=new Engagement(site.store.raw,'test',{clock:()=>now,code:()=>'A2BCD'});
    const jar=new Map<string,string>();
    async function request(route:string,body?:unknown){
      const url=new URL('/api/'+route+'?id=guestbook','http://127.0.0.1:4330');
      const response=await publicApi({site,engagement,analytics:{} as any},{request:new Request(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),url,cookies:{get:(key:string)=>jar.has(key)?{value:jar.get(key)}:undefined,set:(key:string,value:string)=>jar.set(key,value)},identity:{network:'test',protocol:'http',secure:false}} as any,route);
      return response!.json() as Promise<any>;
    }
    await request('v1/engagement');
    const challenge=await request('v1/comment-captcha',{id:'guestbook'});
    const posted=await request('v1/comment',{id:'guestbook',author:'读者',body:'原来的留言',captchaId:challenge.id,captcha:'A2BCD',clientId:'guestbook-first-123'});
    const comment=posted.comment;
    expect(posted.items).toHaveLength(1);
    expect(await request('v1/comment-like',{id:'guestbook',commentId:comment.id,liked:true})).toMatchObject({likes:1,liked:true});
    expect((await request('v1/engagement')).items[0]).toMatchObject({id:comment.id,likes:1,liked:true});
    now+=16000;
    const second=await request('v1/comment-captcha',{id:'guestbook'});
    const reply=await request('v1/comment',{id:'guestbook',author:'回复者',body:'收到你的留言',parentId:comment.id,captchaId:second.id,captcha:'A2BCD',clientId:'guestbook-reply-123'});
    expect(reply.comment).toMatchObject({parentId:comment.id,replyTo:'读者'});
    await expect(request('v1/comment-like',{id:'archive',commentId:comment.id,liked:true})).rejects.toMatchObject({status:404});
    expect(supportsDiscussion(site.store.get('entry','post')!.value)).toBe(true);
    expect(supportsDiscussion(site.store.get('entry','archive')!.value)).toBe(false);
  } finally {site.close();}
});
