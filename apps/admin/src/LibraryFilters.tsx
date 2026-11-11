import {SlidersHorizontal} from 'lucide-react';
import {Popover} from './Popover.tsx';
import {isNoteType} from '@weava/contracts';
import type {ContentLibraryModel} from './content-models.ts';

export function LibraryFilters({model}:{model:ContentLibraryModel}) {
  const {state,libraryType,setLibraryType,visibility,setVisibility,fieldFilters,setFieldFilters,setLibrarySort,setLibraryPage}=model;
  const types=state.types.filter(row=>!isNoteType(row.value));
  const fields=(types.length===1?types[0]:types.find(row=>row.id===libraryType))?.value.fields.filter(field=>field.filterable)??[];
  const count=Number(visibility!=='all')+Number(types.length>1&&!!libraryType)+Object.values(fieldFilters).filter(Boolean).length;
  function clear() {
    setVisibility('all');setLibraryType('');setFieldFilters({});setLibraryPage(1);
  }
  return <Popover label="筛选内容" className="library-filter-popover" trigger={<><SlidersHorizontal size={17} aria-hidden="true"/>筛选{count>0&&<span className="filter-count">{count}</span>}</>}>
    {close=><>
      <div className="library-filter-body">
        <fieldset><legend>可见性</legend><div className="filter-choices" role="group" aria-label="内容可见性">
          {([['all','全部'],['public','公开'],['private','私密']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={visibility===value} onClick={()=>setVisibility(value)}>{label}</button>)}
        </div></fieldset>
        {types.length>1&&<fieldset><legend>内容类型</legend><div className="filter-choices" role="group" aria-label="筛选内容类型">
          {[{id:'',label:'全部'},...types.map(row=>({id:row.id,label:row.value.label}))].map(type=><button type="button" key={type.id} aria-pressed={libraryType===type.id} onClick={()=>{setLibraryType(type.id);setFieldFilters({});setLibrarySort('');}}>{type.label}</button>)}
        </div></fieldset>}
        {fields.map(field=><label className="library-field-filter" key={field.key}>{field.label}
          {field.type==='select'||field.type==='boolean'?<select aria-label={'筛选'+field.label} value={fieldFilters[field.key]??''} onChange={event=>setFieldFilters({...fieldFilters,[field.key]:event.target.value})}>
            <option value="">全部</option>
            {(field.type==='boolean'?['true','false']:field.options??[]).map(option=><option key={option} value={option}>{field.type==='boolean'?(option==='true'?'是':'否'):field.optionLabels?.[option]??option}</option>)}
          </select>:<input aria-label={'筛选'+field.label} type={field.type==='number'?'number':field.type==='date'?'date':'text'} value={fieldFilters[field.key]??''} onChange={event=>setFieldFilters({...fieldFilters,[field.key]:event.target.value})}/>}
        </label>)}
      </div>
      <footer className="library-filter-footer"><button type="button" onClick={clear} disabled={!count}>全部清除</button><button type="button" className="primary" onClick={close}>完成</button></footer>
    </>}
  </Popover>;
}
