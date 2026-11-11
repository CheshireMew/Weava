import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { number } from './format.ts';

type Series = { name: string; color: string; values: number[]; total?: number };
export function Trend({ dates, series, empty, defaultVisible = series.length }: { dates: string[]; series: Series[]; empty: boolean; defaultVisible?: number }) {
  const [index,setIndex]=useState<number|null>(null),[selected,setSelected]=useState<string[]|null>(null);
  const plot=useRef<HTMLDivElement>(null),[width,setWidth]=useState(820);
  useLayoutEffect(()=>{
    const element=plot.current;if(!element)return;
    const resize=()=>{const value=element.getBoundingClientRect().width;if(value)setWidth(Math.max(240,Math.round(value)));};resize();
    if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect();
  },[empty]);
  const dateKey=dates.join(',');
  useEffect(()=>setIndex(null),[dateKey]);
  const score=(s:Series)=>s.total??s.values.reduce((sum,value)=>sum+value,0);
  const active=series.filter(s=>score(s)>0).sort((a,b)=>score(b)-score(a));
  const defaults=(active.length?active:series).slice(0,defaultVisible).map(s=>s.name);
  const chosen=selected??defaults,visible=series.filter(s=>chosen.includes(s.name));
  const max=visible.reduce((value,s)=>s.values.reduce((value,n)=>Math.max(value,n),value),1);
  const power=10**Math.floor(Math.log10(max/4)),step=Math.max(1,([1,2,5,10].find(n=>n*power>=max/4)??10)*power),ceiling=Math.ceil(max/step)*step;
  const height=width<500?220:260,left=42,right=18,top=20,bottom=height-34;
  const x=(i:number)=>left+(dates.length===1?(width-left-right)/2:i/(dates.length-1)*(width-left-right));
  const y=(value:number)=>bottom-value/ceiling*(bottom-top);
  const toggle=(name:string)=>setSelected(chosen.includes(name)?chosen.filter(value=>value!==name):[...chosen,name]);
  const select=(event:PointerEvent<SVGSVGElement>)=>{
    const bounds=event.currentTarget.getBoundingClientRect();
    setIndex(Math.max(0,Math.min(dates.length-1,Math.round((((event.clientX-bounds.left)/bounds.width)*width-left)/(width-left-right)*(dates.length-1)))));
  };
  const ticks=[...new Set(width<500?[0,Math.floor((dates.length-1)/2),dates.length-1]:[0,Math.floor((dates.length-1)/4),Math.floor((dates.length-1)/2),Math.floor((dates.length-1)*3/4),dates.length-1])];
  return <div className="analytics-trend">
    <div className="analytics-chart-heading">
      <div className="analytics-legend">{series.map(s=><button className="analytics-legend-group" key={s.name} aria-label={'显示或隐藏'+s.name} aria-pressed={chosen.includes(s.name)} onClick={()=>toggle(s.name)}><span><i style={{borderColor:s.color}}/>{s.name}</span><strong>{number(score(s))}</strong></button>)}</div>
    </div>
    {empty?<p className="analytics-empty analytics-empty-chart">所选日期范围内暂无记录。</p>:<div ref={plot} className="analytics-chart-plot">
      <svg viewBox={'0 0 '+width+' '+height} height={height} role="img" aria-label="访问趋势，可用左右方向键逐日查看数值" tabIndex={0} onPointerMove={select} onPointerLeave={()=>setIndex(null)} onBlur={()=>setIndex(null)} onKeyDown={event=>{
        if(['ArrowLeft','ArrowRight','Home','End','Escape'].includes(event.key)){event.preventDefault();setIndex(old=>event.key==='Escape'?null:event.key==='Home'?0:event.key==='End'?dates.length-1:Math.max(0,Math.min(dates.length-1,(old??0)+(event.key==='ArrowLeft'?-1:1))));}
      }}>
        {Array.from({length:Math.round(ceiling/step)+1},(_,n)=><g key={n}><line x1={left} x2={width-right} y1={y(step*n)} y2={y(step*n)} className="analytics-grid-line"/><text x={left-10} y={y(step*n)+4} textAnchor="end">{number(step*n)}</text></g>)}
        {visible.map(s=>dates.length===1?<circle key={s.name} data-series={s.name} cx={x(0)} cy={y(s.values[0]||0)} r="4" fill={s.color}/>:<polyline key={s.name} data-series={s.name} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={dates.map((_,i)=>x(i)+','+y(s.values[i]||0)).join(' ')}/>)}
        {ticks.map(i=><text key={i} x={x(i)} y={height-7} textAnchor="middle">{dates[i]?.slice(5)}</text>)}
        {!visible.length&&<text x={width/2} y={height/2} textAnchor="middle">点击上方来源查看趋势</text>}
        {index!==null&&<g><line x1={x(index)} x2={x(index)} y1={top} y2={bottom} stroke="var(--ink-muted)" strokeDasharray="3 3"/>{visible.map(s=><circle key={s.name} cx={x(index)} cy={y(s.values[index]||0)} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2"/>)}</g>}
      </svg>
      {index!==null&&<div className={'analytics-chart-tooltip'+(index>dates.length/2?' tooltip-left':'')} role="status"><strong>{dates[index]}</strong>{visible.map(s=><div key={s.name}><i style={{borderColor:s.color}}/><span>{s.name}</span><b>{number(s.values[index]||0)}</b></div>)}</div>}
    </div>}
  </div>;
}
