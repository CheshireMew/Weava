import {defaultMediaUploadLimits,type Settings} from '@weava/contracts';
export function MediaUploadSettings({value,onChange}:{value:Settings;onChange:(patch:Partial<Settings>)=>void}){
  const limits={...defaultMediaUploadLimits,...value.mediaUploadLimits};
  return <section className="form-card"><h2>媒体上传</h2><div className="form-columns">{([['image','图片'],['video','视频'],['audio','音频'],['file','其它附件'],['staging','总暂存容量']] as const).map(([key,label])=><label key={key}>{label}（MB）<input type="number" min="1" max={key==='staging'?8192:2048} step="1" value={limits[key]/1048576} onChange={event=>{const bytes=Number(event.target.value)*1048576;onChange({mediaUploadLimits:{...limits,[key]:bytes}});}}/></label>)}</div><p>总暂存容量包含未完成上传和导入文件，应不小于最大的单文件限制。</p></section>;
}
