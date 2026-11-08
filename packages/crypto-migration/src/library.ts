import { load } from 'cheerio';
import { schemaTypes, type Block, type Entry, type Settings, type ContentType } from '@weava/contracts';

/** One-time adapter. The reusable theme has no knowledge of this source site. */
export function convertCryptoLibrary(entries: Entry[], settings: Settings, types: ContentType[]) {
  const paths = new Map(entries.map(entry => [entry.path, entry]));
  const assets: Record<string,string> = {};
  const downloadIds = new Set<string>();
  for (const entry of entries.filter(e=>e.kind==='page'&&e.compatibility?.main)) {
    const doc=load(entry.compatibility!.main);
    const scope=JSON.parse(doc('#catalog-grid').attr('data-scope')||'{}');
    if(scope.mode==='downloads')for(const id of scope.ids??[])downloadIds.add(id);
  }
  const converted = entries.map(original => {
    if (!original.compatibility?.main) return original;
    const entry = structuredClone(original), $ = load(entry.compatibility!.main, null, false);
    const head=load(original.compatibility?.head||'');
    const nodes=head('script[type="application/ld+json"]').toArray().flatMap(node=>{try{const value=JSON.parse(head(node).text());return Array.isArray(value)?value:value['@graph']||[value];}catch{return [];}});
    const primary=nodes.find(node=>schemaTypes.includes(node['@type'])&&(!node.url||node.url===settings.domain+entry.path));
    if(primary)entry.seo={schemaType:primary['@type'],...(primary.author?.url?{authorUrl:primary.author.url}:{}),...entry.seo};
    delete entry.compatibility;
    if (entry.kind === 'content') {if(downloadIds.has(entry.id))entry.tags=[...new Set([...entry.tags,'下载入口'])];return entry;}
    entry.fields.libraryDescription = $('.page-heading>p').length>0;
    let n = 0;
    const block = (type: string, props: Record<string,any>): Block => ({id:'library-'+(++n),type,props});
    const idsIn = (node: any) => [...new Set($(node).find('a[href]').toArray().map(a=>paths.get($(a).attr('href')!)?.id).filter((id):id is string=>!!id&&entries.find(e=>e.id===id)?.kind==='content'))];
    const linksIn = (node: any) => $(node).find('a[href]').toArray().map(a=>({url:$(a).attr('href')!,label:$(a).find('h2,h3,strong').first().text()||$(a).text().trim(),description:$(a).find('p').first().text(),icon:$(a).find('.platform-symbol').text()}));
    const collection = (node:any, presentation='cards'): Block => {
      const ids=idsIn(node), items=ids.map(id=>entries.find(e=>e.id===id)!);
      const fields:Record<string,string>={};
      for(const key of ['platform','service','kind']) {const values=[...new Set(items.map(e=>e.fields[key]))];if(values.length===1&&values[0]&&!(key==='kind'&&values[0]==='article'))fields[key]=values[0];}
      const category=[...new Set(items.flatMap(e=>e.categories))];
      return block('collection',{title:$(node).find('h2').first().text(),presentation,limit:Math.min(100,Math.max(3,ids.length)),pagination:false,
        ...(presentation==='list'?{ids}: {fields,...(category.length===1?{category:category[0]}:{})})});
    };
    const visit = (node:any):Block[] => {
      const el=$(node);
      if(el.hasClass('page-heading'))return [];
      if(el.hasClass('hero')) {
        const svg=el.find('svg.hero-art'); if(svg.length){svg.attr('xmlns','http://www.w3.org/2000/svg');assets['hero.svg']=$.html(svg)};
        return [block('hero',{title:el.find('h1').text().replace('，','，\n'),highlight:el.find('h1 span').text(),description:el.find('.hero-copy>p').text(),buttonLabel:el.find('.hero-actions a').first().text().trim(),buttonUrl:el.find('.hero-actions a').first().attr('href'),secondaryLabel:el.find('.hero-actions a').eq(1).text().trim(),secondaryUrl:el.find('.hero-actions a').eq(1).attr('href'),image:svg.length?'/site-assets/hero.svg':''})];
      }
      if(el.hasClass('catalog-layout')) {
        const scope=JSON.parse(el.find('#catalog-grid').attr('data-scope')||'{}');
        const fields:Record<string,string>={};if(scope.platform)fields.platform=scope.platform;if(scope.wallet)fields.service='web3';if(['graphic','video'].includes(scope.mode))fields.kind=scope.mode;
        const category=scope.category || undefined;
        return [block('collection',{presentation:'catalog',basePath:scope.base||entry.path.replace(/page\/\d+\/$/,''),limit:36,filters:'show',fields,category,...(scope.mode==='guides'?{contentType:'post'}:{}),...(scope.mode==='downloads'?{tag:'下载入口'}:{} )})];
      }
      if(el.hasClass('platform-overview'))return [block('link-list',{presentation:'tiles',items:linksIn(node)})];
      if(el.hasClass('start-strip'))return [block('link-list',{title:el.find('h2').text(),presentation:'steps',items:linksIn(node)})];
      if(el.hasClass('equities-page')) {
        const copy=load($.html(node),null,false);copy('#eq-list').empty();copy('noscript').remove();
        assets['stocks.html']=copy.html();
        return [block('crypto-blacknico:stocks',{})];
      }
      if(el.find('[data-announcements]').length||el.is('[data-announcements]')) {
        const notes=el.find('.announcements-note').toArray().map(note=>$.html(note)).join('');
        return [block('crypto-blacknico:announcements',{}),...(notes?[block('richtext',{text:'<section class="wrap">'+notes+'</section>'})]:[])];
      }
      if(el.hasClass('referral-grid'))return [block('crypto-blacknico:referrals',{
        providers:el.find('[data-provider]').toArray().map(x=>$(x).attr('data-provider')),
        items:el.find('[data-provider]').toArray().map(x=>{
          const card=$(x),provider=card.attr('data-provider')!,config=(settings.extensions.crypto as any)?.config?.referrals?.[provider];
          return {provider,title:card.find('h3').first().text(),description:card.children('p').map((_i,p)=>$(p).text()).get(),actionLabel:card.find('a.button').first().text().trim(),note:card.find('.referral-note').text(),codes:card.find('.invite-row').toArray().map(row=>({label:$(row).find('span').first().text(),key:config?.futuresCode&&$(row).find('[data-copy]').attr('data-copy')===config.futuresCode?'futuresCode':'code'}))};
        }),
      })];
      if(el.hasClass('learning-stage'))return [collection(node,'list')];
      if(el.find('.topic-grid').length)return [block('link-list',{title:el.find('h2').first().text(),presentation:'topics',items:linksIn(el.find('.topic-grid'))})];
      if(el.find('.card-grid,.article-cards,.featured-grid').length)return [collection(node)];
      if(el.hasClass('basics-feature')||el.find('.basics-feature').length)return [collection(node,'list')];
      if(el.find('.catalog-layout,.referral-grid,.learning-stage,.platform-overview').length)return el.children().toArray().flatMap(visit).map(child=>el.hasClass('section')&&el.hasClass('wrap')&&child.type==='richtext'?{...child,props:{...child.props,text:'<section class="section wrap">'+child.props.text+'</section>'}}:child);
      // Editorial prose remains editable content, never a saved page/head/navigation shell.
      el.find('script,style').remove();
      return [block('richtext',{text:$.html(node)})];
    };
    entry.blocks=$.root().children().toArray().flatMap(visit);
    entry.document={version:1,format:'markdown',source:''};
    entry.template='page';
    return entry;
  });
  const optionLabels={binance:'币安',okx:'OKX',general:'原创文章',exchange:'交易所',web3:'Web3 钱包',article:'学习指南',graphic:'知识图解',video:'视频教程'};
  const fields = ['platform','service','kind'].map(key=>({key,label:({platform:'平台',service:'服务',kind:'内容形式'})[key]!,type:'select' as const,filterable:true,optionLabels,options:[...new Set(entries.filter(e=>e.kind==='content').map(e=>e.fields[key]).filter(Boolean))] as string[]}));
  const nextTypes=types.map(t=>({...t,fields:[...t.fields.filter(f=>!['platform','service','kind','readMinutes'].includes(f.key)),...fields,{key:'readMinutes',label:'阅读分钟数',type:'number' as const,min:1}],admin:{...t.admin,columns:['title','platform','kind','updatedAt']}}));
  const shell=load(entries.find(e=>e.path==='/')?.compatibility?.shell||'');
  const nextSettings:Settings={...settings,theme:'library',extensions:{...settings.extensions,library:{brandTitle:shell('.brand-word').first().clone().children().remove().end().text()||settings.name,brandSubtitle:shell('.brand-by').first().text(),favicon:'/site-assets/favicon.svg',footerLinks:shell('.footer-main>div a').toArray().map(a=>({label:shell(a).text(),url:shell(a).attr('href')}))}}};
  return {entries:converted,settings:nextSettings,types:nextTypes,assets};
}
