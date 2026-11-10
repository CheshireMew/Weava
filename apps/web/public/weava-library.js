(() => {
  const messages=JSON.parse(document.getElementById('weava-i18n')?.textContent||'{}');
  const t=(text,values={})=>(messages[text]||text).replace(/\{(\w+)\}/g,(match,key)=>values[key]===undefined?match:String(values[key]));

  const menu=document.querySelector('.mobile-menu'),nav=document.getElementById('main-nav'),search=document.getElementById('library-search');
  menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));nav?.classList.toggle('open',open);});
  const open=()=>{search?.showModal();search?.querySelector('input')?.focus();};
  document.querySelector('[data-library-search]')?.addEventListener('click',open);
  document.querySelector('[data-library-close]')?.addEventListener('click',()=>search?.close());
  document.addEventListener('keydown',event=>{if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!document.activeElement?.isContentEditable){event.preventDefault();open();}});
  document.querySelectorAll('.article-body img').forEach(img=>{if(img.closest('a,button'))return;img.tabIndex=0;const openImage=()=>{const dialog=document.createElement('dialog');dialog.className='lightbox';dialog.setAttribute('aria-label',img.alt||t('查看大图'));const full=document.createElement('img');full.src=img.src;full.alt=img.alt;dialog.append(full);dialog.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();};img.addEventListener('click',openImage);img.addEventListener('keydown',event=>{if(event.key==='Enter')openImage();});});
})();
