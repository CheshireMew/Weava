(() => {
  if(document.documentElement.dataset.cryptoBusiness)return;
  document.documentElement.dataset.cryptoBusiness='true';
  document.querySelectorAll('[data-crypto-copy]').forEach(button=>button.addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(button.dataset.cryptoCopy);button.textContent='已复制';}catch{button.textContent='请手动复制';}
  }));
  document.querySelectorAll('video[data-video-key]').forEach(video=>{
    const note=video.closest('figure')?.querySelector('.video-error');let tried=false;
    const reload=()=>{video.src='/video/'+encodeURIComponent(video.dataset.videoKey)+'?refresh='+Date.now();video.load();video.play().catch(()=>{if(note)note.hidden=false;});};
    video.addEventListener('error',()=>{if(!tried){tried=true;reload();}else if(note)note.hidden=false;});
    note?.querySelector('[data-video-retry]')?.addEventListener('click',reload);
  });
  const widget=document.querySelector('[data-crypto-announcements]');
  if(widget){let busy=false;const refresh=async()=>{if(busy||document.hidden)return;busy=true;try{
    const response=await fetch('/api/announcements',{cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();
    widget.replaceChildren(...data.feeds.map(feed=>{const section=document.createElement('section');section.className='announcement-feed';
      const h=document.createElement('h3');h.textContent=feed.label||feed.name||feed.id;
      const status=document.createElement('p');status.className='announcement-updated';status.textContent=(feed.stale?'上次保存 ':'更新于 ')+(feed.updatedAt||'尚未更新');
      const list=document.createElement('ul');list.className='announcement-list';for(const item of feed.items.slice(0,8)){const li=document.createElement('li'),a=document.createElement('a');a.href=item.url;a.textContent=item.title;a.rel='sponsored noopener';a.target='_blank';li.append(a);list.append(li);}section.append(h,status,list);return section;}));
  }catch{widget.setAttribute('aria-label','实时更新暂不可用，已保留上次公告');}finally{busy=false;}};refresh();setInterval(refresh,60000);}
})();
