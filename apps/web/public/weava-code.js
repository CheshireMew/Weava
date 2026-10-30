document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy-code]');
  if (!button) return;
  try {
    const code = button.closest('.code-block').querySelector('pre[data-code-source]');
    await navigator.clipboard.writeText(decodeURIComponent(code.dataset.codeSource));
    button.textContent = '已复制';
  } catch { button.textContent = '无法复制，请选中代码复制'; }
});
