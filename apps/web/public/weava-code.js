(() => {
  const messages=JSON.parse(document.getElementById('weava-i18n')?.textContent||'{}');
  const t=(text,values={})=>(messages[text]||text).replace(/\{(\w+)\}/g,(match,key)=>values[key]===undefined?match:String(values[key]));
  document.querySelectorAll('[data-copy-code]').forEach(button=>{button.textContent=t('复制代码');button.setAttribute('aria-label',t('复制代码'));});
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy-code]');
  if (!button) return;
  try {
    const code = button.closest('.code-block').querySelector('pre[data-code-source]');
    await navigator.clipboard.writeText(decodeURIComponent(code.dataset.codeSource));
    button.textContent = t('已复制');
  } catch { button.textContent = t('无法复制，请选中代码复制'); }
});

})();
