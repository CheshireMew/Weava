import { blockDefinitions, contentBlockIssues, type Block, type BlockControl } from '@weava/contracts';
import { useSelectors } from './Selectors.tsx';
import { findBlock, patchBlock, removeBlock, moveBlock, cloneBlocks, insertAfter } from './block-tree.ts';

export interface BlockCatalog { allowedBlocks?:string[]; layouts?: any[]; types?: any[]; terms?: any[]; extensionBlocks?: string[]; extensionBlockDefinitions?: Record<string, { label: string; fields: BlockControl[] }> }
export function BlockProperties({ value: block, onChange, catalog = {}, contentOnly = false }: { value: Block; onChange: (value: Block) => void; catalog?: BlockCatalog; contentOnly?: boolean }) {
  const selectors = useSelectors();
  const change = (key: string, value: any) => onChange({ ...block, props: { ...block.props, [key]: value, ...(key === 'contentType' ? { fields: {} } : {}) } });
  const style = (value: Partial<NonNullable<Block['style']>>) => onChange({ ...block, style: { ...block.style, ...value } });
  const controls = ((blockDefinitions[block.type] ?? catalog.extensionBlockDefinitions?.[block.type])?.fields ?? []).filter(field => !contentOnly || !block.bindings?.[field.key]);
  const fieldChoices = (catalog.types ?? []).flatMap((row) => row.value.fields ?? []);
  const chooseMedia = async (key: string) => {
    const media = await selectors.media(key === 'poster' || key === 'image' || block.type === 'image' || block.type === 'image-text' ? 'image' : block.type === 'video' ? 'video' : undefined);
    if (media) onChange({ ...block, props: { ...block.props, [key]: media.url, ...(key === 'src' && media.kind === 'image' ? { alt: media.alt ?? media.name, caption: media.caption ?? '' } : {}) } });
  };
  const control = (field: BlockControl) => {
    const value = block.props[field.key] ?? '';
    let options = field.options?.map((value) => ({ id: value, label: value }));
    if (field.key === 'layoutId') options = (catalog.layouts ?? []).filter((row) => row.value.kind === 'region').map((row) => ({ id: row.id, label: row.value.label }));
    if (field.key === 'contentType') options = (catalog.types ?? []).map((row) => ({ id: row.id, label: row.value.label }));
    if (field.key === 'category' || field.key === 'tag') options = (catalog.terms ?? []).filter((row) => row.value.kind === (field.key === 'category' ? 'category' : 'tag')).map((row) => ({ id: row.id, label: row.value.label }));
    if (options) return <select value={value} onChange={(event) => change(field.key, event.target.value)}><option value="">默认</option>{options.map((item) => <option key={item.id} value={item.id}>{(['sort', 'filters', 'cover'].includes(field.key) ? ({ date: '最新', oldest: '最早', title: '标题', show: '显示', hide: '隐藏' } as any)[item.id] : undefined) ?? item.label}</option>)}</select>;
    if (field.control === 'textarea') return <textarea rows={5} value={value} onChange={(event) => change(field.key, event.target.value)} />;
    if (field.control === 'media') return contentOnly ? <span className="page-media-field">{value && ['image', 'image-text', 'hero'].includes(block.type) && <img src={value} alt="" />}<button type="button" onClick={() => void chooseMedia(field.key)}>{value ? '更换' : '选择'}{['image', 'image-text', 'hero'].includes(block.type) ? '图片' : '媒体'}</button></span> : <span className="selector-field"><input value={value} onChange={(event) => change(field.key, event.target.value)} /><button type="button" onClick={() => void chooseMedia(field.key)}>选择媒体</button></span>;
    if (field.control === 'content' || field.control === 'url') return <span className="selector-field"><input value={value} onChange={(event) => change(field.key, event.target.value)} /><button type="button" onClick={async () => { const content = await selectors.content(); if (content) change(field.key, field.control === 'content' ? content.id : 'entry:' + encodeURIComponent(content.id)); }}>选择内容</button></span>;
    return <input type={field.control === 'number' ? 'number' : 'text'} value={value} onChange={(event) => change(field.key, field.control === 'number' ? Number(event.target.value) : event.target.value)} />;
  };
  return <div className="block-properties">
    {controls.map((field) => <div className="block-property" key={field.key}><label>{field.label}{control(field)}</label>
      {!contentOnly && ['text','textarea','media','number','url'].includes(field.control) && <details><summary>关联字段</summary><select aria-label={field.label + '关联字段'} value={block.bindings?.[field.key] ? block.bindings[field.key].source + ':' + block.bindings[field.key].key : ''} onChange={(event) => {
        const bindings = { ...block.bindings }; const [source, key] = event.target.value.split(':');
        if (!source) delete bindings[field.key]; else bindings[field.key] = { source: source as 'entry' | 'site' | 'field', key };
        onChange({ ...block, bindings });
      }}><option value="">固定内容</option><optgroup label="内容">{['title','description','cover','author'].map((key) => <option key={key} value={'entry:' + key}>{({title:'标题',description:'摘要',cover:'封面',author:'作者'} as any)[key]}</option>)}</optgroup><optgroup label="网站">{['name','description','logo'].map((key) => <option key={key} value={'site:' + key}>{({name:'网站名称',description:'网站介绍',logo:'Logo'} as any)[key]}</option>)}</optgroup><optgroup label="自定义字段">{Array.from(new Map(fieldChoices.map((field) => [field.key,field])).values()).map((field: any) => <option key={field.key} value={'field:' + field.key}>{field.label}</option>)}</optgroup></select></details>}
    </div>)}
    {['content-list', 'cards','collection'].includes(block.type) && <details><summary>固定字段条件</summary>{Array.from(new Map((catalog.types ?? []).filter(row=>!block.props.contentType||row.id===block.props.contentType).flatMap(row=>row.value.fields.filter((field:any)=>field.filterable)).map((field:any)=>[field.key,field])).values()).map((field: any) => <label key={field.key}>{field.label}<input value={block.props.fields?.[field.key] ?? ''} onChange={(event) => { const fields = { ...block.props.fields }; if (event.target.value) fields[field.key] = event.target.value; else delete fields[field.key]; change('fields', fields); }} /></label>)}</details>}
    {block.type==='link-list'&&<div>{(block.props.items??[]).map((item:any,index:number)=><div className="repeat-item" key={index}>{[['label','名称'],['url','网址'],['description','说明'],['icon','图标文字']].map(([key,label])=><label key={key}>{label}<input value={item[key]??''} onChange={event=>change('items',block.props.items.map((row:any,i:number)=>i===index?{...row,[key]:event.target.value}:row))}/></label>)}<button onClick={()=>change('items',block.props.items.filter((_:any,i:number)=>i!==index))}>移除链接</button></div>)}<button onClick={()=>change('items',[...(block.props.items??[]),{label:'',url:'/'}])}>添加链接</button></div>}
    {block.type === 'gallery' && <div>{(block.props.images ?? []).map((image: any, index: number) => <div className="repeat-item" key={index}>
      {image.src && <img src={image.src} alt="" />}<label>图片地址<input value={image.src ?? image} onChange={(event) => change('images', block.props.images.map((item: any,i: number) => i === index ? { ...(typeof item === 'string' ? {} : item), src: event.target.value } : item))} /></label>
      <label>图片说明<input value={image.alt ?? ''} onChange={(event) => change('images', block.props.images.map((item: any,i: number) => i === index ? { ...item, alt: event.target.value } : item))} /></label>
      <button onClick={() => change('images', block.props.images.filter((_: any,i: number) => i !== index))}>移除图片</button>
    </div>)}<button onClick={async () => { const image = await selectors.media('image'); if(image) change('images',[...(block.props.images ?? []),{src:image.url,alt:image.alt ?? image.name}]); }}>添加图片</button></div>}
    {block.type === 'faq' && <div>{(block.props.items ?? []).map((item: any,index: number) => <div className="repeat-item" key={index}>
      <label>问题<input value={item.question} onChange={(event) => change('items',block.props.items.map((item: any,i: number) => i === index ? {...item,question:event.target.value}:item))} /></label>
      <label>回答<textarea value={item.answer} onChange={(event) => change('items',block.props.items.map((item: any,i: number) => i === index ? {...item,answer:event.target.value}:item))} /></label>
      <button onClick={() => change('items',block.props.items.filter((_: any,i: number) => i !== index))}>移除问答</button>
    </div>)}<button onClick={() => change('items',[...(block.props.items ?? []),{question:'',answer:''}])}>添加问题</button></div>}
    {!contentOnly && <details><summary>布局</summary><label>宽度<select value={block.style?.width ?? 'normal'} onChange={(event) => style({width:event.target.value as any})}><option value="normal">正文宽度</option><option value="wide">宽版</option><option value="full">铺满</option></select></label>
      <label>对齐<select value={block.style?.align ?? 'left'} onChange={(event) => style({align:event.target.value as any})}><option value="left">左</option><option value="center">中</option><option value="right">右</option></select></label>
      <label>内边距<input type="number" min="0" max="160" value={block.style?.padding ?? 0} onChange={(event) => style({padding:Number(event.target.value)})} /></label>
      <label>间距<input type="number" min="0" max="120" value={block.style?.gap ?? 24} onChange={(event) => style({gap:Number(event.target.value)})} /></label>
      <label>背景<input type="color" value={block.style?.background ?? '#ffffff'} onChange={(event) => style({background:event.target.value})} /></label>
      <label>文字颜色<input type="color" value={block.style?.textColor ?? '#202a25'} onChange={(event) => style({textColor:event.target.value})} /></label>
      <label>正文字号<input type="number" min="14" max="32" placeholder="跟随主题" value={block.style?.fontSize ?? ''} onChange={(event) => style({fontSize:event.target.value ? Number(event.target.value) : undefined})} /></label>
      <label>标题字号<input type="number" min="20" max="72" placeholder="跟随主题" value={block.style?.headingSize ?? ''} onChange={(event) => style({headingSize:event.target.value ? Number(event.target.value) : undefined})} /></label>
      {block.type === 'columns' && (['desktop','tablet','mobile'] as const).map((size) => <label key={size}>{({desktop:'桌面列数',tablet:'平板列数',mobile:'手机列数'})[size]}<input type="number" min="1" max={size === 'mobile' ? 2 : size === 'tablet' ? 4 : 6} value={block.style?.columns?.[size] ?? (size === 'mobile' ? 1 : 2)} onChange={(event) => style({columns:{desktop:2,tablet:2,mobile:1,...block.style?.columns,[size]:Number(event.target.value)}})} /></label>)}
    </details>}
  </div>;
}
