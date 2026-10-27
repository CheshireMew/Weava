(() => {
  const menu = document.querySelector('.menu-button');
  menu?.addEventListener('click', () => {
    menu.setAttribute('aria-expanded', String(menu.getAttribute('aria-expanded') !== 'true'));
  });
  document.querySelectorAll('.prose img').forEach((image) => {
    image.addEventListener('click', () => {
      const dialog = document.createElement('dialog');
      dialog.className = 'lightbox';
      const close = document.createElement('button');
      close.textContent = '×';
      close.setAttribute('aria-label', '关闭');
      const large = document.createElement('img');
      large.src = image.currentSrc || image.src;
      large.alt = image.alt;
      dialog.append(close, large);
      dialog.addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => dialog.remove());
      document.body.append(dialog);
      dialog.showModal();
    });
  });
})();
