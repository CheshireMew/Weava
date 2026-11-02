import { useEffect, useState } from 'react';
import { ApiClientError } from '@weava/contracts/api-client';
export function useAuthCooldown() {
  const [until,setUntil]=useState(0),[now,setNow]=useState(Date.now());
  useEffect(()=>{if(!until)return;const timer=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(timer);},[until]);
  function record(error:unknown) {
    if(!(error instanceof ApiClientError)||error.status!==429)return;
    const detail=error.details as {retryAt?:number;retryAfter?:number}|undefined;
    const duration=error.retryAfter??detail?.retryAfter??1;
    const next=typeof detail?.retryAt==='number'?detail.retryAt:Date.now()+duration*1000;
    setNow(Date.now());setUntil(Math.max(next,Date.now()+1000));
  }
  return {seconds:Math.max(0,Math.ceil((until-now)/1000)),record};
}
