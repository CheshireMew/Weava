import {createHash,randomUUID} from 'node:crypto';
import {load} from 'cheerio';
import {BoundedCache} from '../../../../packages/core/src/cache.ts';

interface Body {parts:string[];byline:boolean}
const bodies=new BoundedCache<string,Body>(64,16*1024*1024);
/** Cache authored markup; request-specific edit links and live actions stay separate. */
export function renderArticleBody(html:string,edit='',actions=''){
  const key=createHash('sha256').update(html).digest('hex');
  let body=bodies.get(key);
  if(!body){
    const $=load(html,{},false),meta=$('.article-heading > .meta').first();
    if(meta.length){
      const editSlot='weava-edit-'+randomUUID(),actionSlot='weava-actions-'+randomUUID();
      meta.append(editSlot);meta.wrap('<div class="nl-article-byline"></div>');meta.parent().append(actionSlot);
      const rendered=$.html(),atEdit=rendered.indexOf(editSlot),atActions=rendered.indexOf(actionSlot);
      body={byline:true,parts:[rendered.slice(0,atEdit),rendered.slice(atEdit+editSlot.length,atActions),rendered.slice(atActions+actionSlot.length)]};
    }else body={byline:false,parts:[$.html()]};
    bodies.set(key,body,body.parts.reduce((sum,part)=>sum+part.length*2,0));
  }
  return body.byline?body.parts[0]+edit+body.parts[1]+actions+body.parts[2]:edit+actions+body.parts[0];
}
