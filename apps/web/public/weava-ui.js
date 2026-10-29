(() => {
  const menu = document.querySelector('.menu-button');
  const navigation = document.getElementById(menu?.getAttribute('aria-controls'));
  const closeMenu = (restoreFocus = false) => {
    if (menu?.getAttribute('aria-expanded') !== 'true') return;
    menu.setAttribute('aria-expanded', 'false');
    if (restoreFocus) menu.focus();
  };
  menu?.addEventListener('click', () => {
    menu.setAttribute('aria-expanded', String(menu.getAttribute('aria-expanded') !== 'true'));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu(true);
  });
  document.addEventListener('click', (event) => {
    if (!menu?.contains(event.target) && !navigation?.contains(event.target)) closeMenu();
  });
  navigation?.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });
  window.matchMedia('(min-width: 721px)').addEventListener('change', () => closeMenu());

  document.querySelectorAll('.prose img').forEach((image) => {
    if (image.closest('a, button, [hidden]') || getComputedStyle(image).display === 'none') return;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'lightbox-trigger';
    trigger.setAttribute('aria-label', image.alt ? '放大图片：' + image.alt : '放大图片');
    trigger.setAttribute('aria-haspopup', 'dialog');
    image.replaceWith(trigger);
    trigger.append(image);
    trigger.addEventListener('click', () => {
      const dialog = document.createElement('dialog');
      dialog.className = 'lightbox';
      dialog.setAttribute('aria-label', image.alt || '图片预览');
      const close = document.createElement('button');
      close.textContent = '×';
      close.setAttribute('aria-label', '关闭');
      const large = document.createElement('img');
      large.src = image.currentSrc || image.src;
      large.alt = image.alt;
      dialog.append(close, large);
      close.addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
      dialog.addEventListener('close', () => { dialog.remove(); trigger.focus({ preventScroll: true }); });
      document.body.append(dialog);
      dialog.showModal();
    });
  });
})();
