(() => {
  const article = document.querySelector('[data-article-body]');
  if (!article) return;

  const formatting = 'p,h1,h2,h3,h4,h5,h6,blockquote,ol,ul,li,dl,dt,dd,table,thead,tbody,tfoot,tr,td,th,figure,figcaption,pre,code,a,b,strong,i,em,u,s,strike,del,ins,mark,small,sub,sup,span';
  const block = 'address,article,aside,blockquote,details,div,dl,figure,footer,h1,h2,h3,h4,h5,h6,header,hr,main,ol,p,pre,section,table,ul';
  const hideFromClipboard = '[hidden],[data-article-actions],.nl-article-edit,.weava-advertisement,[data-copy-code],script,style';

  const absolute = (element, attribute) => {
    const value = element.getAttribute(attribute);
    if (value) element.setAttribute(attribute, new URL(value, document.baseURI).href);
  };

  function wrapUrl(link) {
    if (!/^(https?:\/\/|www\.)\S+$/i.test(link.textContent.trim())) return;
    // Preserve the address and visible text even when the receiving editor drops CSS.
    link.style.overflowWrap = 'anywhere';
    link.style.wordBreak = 'break-all';
    const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const parts = node.data.split(/(?<=[./?&=#_-])(?=[^./?&=#_-])/);
      if (parts.length < 2) continue;
      node.replaceWith(parts[0], ...parts.slice(1).flatMap(part => [document.createElement('wbr'), part]));
    }
  }

  function copyHtml(range) {
    const output = document.createElement('div');
    output.append(range.cloneContents());
    const common = range.commonAncestorContainer;
    const start = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
    for (let ancestor = start; ancestor !== article; ancestor = ancestor.parentElement) {
      if (!ancestor.matches(formatting)) break;
      const wrapper = ancestor.cloneNode(false);
      while (output.firstChild) wrapper.append(output.firstChild);
      output.append(wrapper);
    }

    output.querySelectorAll(hideFromClipboard).forEach(node => node.remove());
    output.querySelectorAll('[class]').forEach(node => node.removeAttribute('class'));
    for (const wrapper of output.querySelectorAll('article,div,section,header,footer,main')) {
      if (wrapper.childNodes.length && [...wrapper.childNodes].every(node =>
        node.nodeType === Node.ELEMENT_NODE ? node.matches(block) : !node.textContent.trim()
      )) wrapper.replaceWith(...wrapper.childNodes);
    }
    for (const link of output.querySelectorAll('a[href]')) {
      absolute(link, 'href');
      wrapUrl(link);
    }
    for (const img of output.querySelectorAll('img')) {
      absolute(img, 'src');
      for (const attribute of ['srcset', 'sizes', 'loading', 'decoding', 'width', 'height']) img.removeAttribute(attribute);
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
    }
    return output.innerHTML;
  }

  document.addEventListener('copy', event => {
    if (event.defaultPrevented || !event.clipboardData || event.target.closest?.('textarea,input,[contenteditable]')) return;
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
    const range = selection.getRangeAt(0);
    if (!article.contains(range.startContainer) || !article.contains(range.endContainer)) return;
    const common = range.commonAncestorContainer;
    const element = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
    if (element.closest('pre')) return;

    let html;
    try { html = copyHtml(range); } catch { return; }
    const plain = selection.toString();
    if (!plain.trim() && !/<img\b|<hr\b/i.test(html)) return;
    event.clipboardData.setData('text/plain', plain);
    event.clipboardData.setData('text/html', html);
    event.preventDefault();
  });
})();
