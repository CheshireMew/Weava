import { load } from 'cheerio';
export function structuredDataIssues(html: string) {
  const $ = load(html), issues: { rule: string; message: string; evidence: string }[] = [];
  const text = load(html); text('script,style,[hidden],[aria-hidden="true"]').remove();
  const visible = text('body').text().replace(/\s+/g, ' ').trim();
  const add = (message: string, evidence: string) => issues.push({ rule: 'schema-content', message, evidence });
  $('script[type="application/ld+json"]').each((_i, script) => {
    let value: any; try { value = JSON.parse($(script).html() || ''); } catch { return; }
    const nodes = Array.isArray(value) ? value : value && typeof value === 'object' ? value['@graph'] ?? [value] : [value];
    if (!Array.isArray(nodes)) { add('结构化数据图需要是节点数组。', '@graph'); return; }
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || !node['@type']) { add('结构化数据节点缺少类型。', JSON.stringify(node)); continue; }
      const url = (value: any) => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
      if (node.url && !url(node.url)) add('结构化数据使用了无效的网址。', String(node.url));
      if (node['@type'] === 'BreadcrumbList') {
        const items = node.itemListElement;
        if (!Array.isArray(items) || items.length < 2 || items.some((item: any, i: number) => item.position !== i + 1 || !item.name || (i < items.length - 1 && !url(typeof item.item === 'object' ? item.item['@id'] : item.item))))
          add('面包屑需要至少两级，名称、顺序和上级网址应完整。', 'BreadcrumbList');
      }
      if (['Article', 'TechArticle'].includes(node['@type'])) {
        if (!node.headline) add('文章结构化数据缺少标题。', node['@type']);
        for (const field of ['datePublished', 'dateModified']) if (node[field] && !Number.isFinite(Date.parse(node[field]))) add('文章结构化数据的日期无效。', field);
      }
      if (node['@type'] === 'VideoObject' && (!node.name || !node.thumbnailUrl || !url(node.thumbnailUrl) || !node.uploadDate)) add('视频结构化数据的名称、缩略图或上传日期不完整。', 'VideoObject');
      if (node['@type'] === 'FAQPage') {
        if (!Array.isArray(node.mainEntity) || !node.mainEntity.length || node.mainEntity.some((q: any) => !q?.name || !q.acceptedAnswer?.text)) add('问答结构化数据缺少问题或答案。', 'FAQPage');
        else for (const q of node.mainEntity) {
          const answer = load(String(q.acceptedAnswer.text), null, false).text().replace(/\s+/g, ' ').trim();
          if (!visible.includes(String(q.name).replace(/\s+/g, ' ').trim()) || !visible.includes(answer)) add('问答结构化数据与可见正文不一致。', String(q.name));
        }
      }
    }
  });
  return issues;
}
