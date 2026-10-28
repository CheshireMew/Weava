import { layoutSchema, WeavaError, type Layout, type Entry, type Release, type Block } from '@weava/contracts';
import type { Site } from './site.ts';

const block = (id: string, type: string, props: Record<string, any> = {}, children?: Block[]): Block => ({ id, type, props, ...(children ? { children } : {}) });
export const builtInLayouts: Layout[] = [
  { id: 'page', label: '页面', kind: 'template', appliesTo: 'page', blocks: [block('body', 'entry-body')] },
  { id: 'article', label: '文章', kind: 'template', appliesTo: 'content', blocks: [block('heading', 'entry-heading'), block('body', 'entry-body'), block('fields', 'entry-fields')] },
  { id: 'portfolio', label: '作品', kind: 'template', appliesTo: 'content', blocks: [block('heading', 'entry-heading'), block('columns', 'columns', { columns: 2 }, [block('body', 'entry-body'), block('fields', 'entry-fields')])] },
  { id: 'documentation', label: '文档', kind: 'template', appliesTo: 'content', blocks: [block('heading', 'entry-heading', { cover: 'hide' }), block('document-layout','columns',{columns:2},[block('outline','entry-toc'),block('body','entry-body')]), block('fields', 'entry-fields')] },
  { id: 'resource', label: '资源', kind: 'template', appliesTo: 'content', blocks: [block('heading', 'entry-heading'), block('fields', 'entry-fields'), block('body', 'entry-body')] },
  { id: 'newsletter-home', label: '刊物首页', kind: 'template', appliesTo: 'page', blocks: [block('body', 'entry-body')] },
  { id: 'newsletter-archive', label: '刊物归档', kind: 'template', appliesTo: 'page', blocks: [block('body', 'entry-body')] },
  { id: 'intro-columns', label: '图文介绍', kind: 'pattern', appliesTo: 'page', blocks: [block('intro', 'hero', { title: '关于我们', description: '介绍你的工作与想法' }), block('columns', 'columns', { columns: 2 }, [block('left', 'text', { text: '## 我们的工作\n\n填写介绍。' }), block('right', 'text', { text: '## 联系我们\n\n填写联系方式。' })])] },
  { id: 'landing', label: '服务介绍', kind: 'pattern', appliesTo: 'page', blocks: [block('hero', 'hero', { title: '让想法成为作品', description: '介绍你提供的服务' }), block('services', 'columns', { columns: 3 }, [block('service-a', 'callout', { title: '设计', text: '清楚表达你的想法。' }), block('service-b', 'callout', { title: '开发', text: '将想法做成产品。' }), block('service-c', 'callout', { title: '维护', text: '持续保持内容与服务可用。' })]), block('faq', 'faq', { items: [{ question: '如何开始？', answer: '写下你的需求。' }] })] },
];

export function layouts(site: Site) {
  const stored = site.store.list('layout');
  return [...builtInLayouts.filter((layout) => !stored.some((row) => row.id === layout.id)).map((value) => ({ id: value.id, revision: null, value, updatedAt: '', builtIn: true })),
    ...stored.map((row) => ({ ...row, builtIn: false }))];
}
export function layoutFor(entry: Entry, release: Release) {
  const id = entry.template ?? (entry.kind === 'content' ? release.types.find((type) => type.id === entry.type)?.template ?? 'article' : 'page');
  const layout = [...(release.layouts ?? []), ...builtInLayouts].find((layout) => layout.id === id);
  if (!layout || layout.kind !== 'template') throw new WeavaError('页面模板不存在：' + id);
  if (layout.appliesTo !== 'any' && layout.appliesTo !== entry.kind) throw new WeavaError('模板不适用于这类内容：' + layout.label);
  return layout;
}
export function visitBlocks(blocks: Block[], visit: (block: Block) => void) {
  for (const item of blocks) { visit(item); visitBlocks(item.children ?? [], visit); }
}
export function referencedLayouts(entry: Entry | undefined, release: Pick<Release, 'settings' | 'types' | 'layouts'>) {
  const catalog = [...(release.layouts ?? []), ...builtInLayouts], found = new Map<string, Layout>();
  const add = (id: string | undefined) => {
    const layout = catalog.find((item) => item.id === id);
    if (!layout || found.has(layout.id)) return;
    found.set(layout.id, layout); visitBlocks(layout.blocks, (block) => { if (block.type === 'shared') add(block.props.layoutId); });
  };
  if (entry) {
    add(entry.template ?? (entry.kind === 'content' ? release.types.find((type) => type.id === entry.type)?.template ?? 'article' : 'page'));
    visitBlocks(entry.blocks, (block) => { if (block.type === 'shared') add(block.props.layoutId); });
  }
  for (const id of Object.values(release.settings.regions ?? {})) add(id);
  return [...found.values()];
}
export function validateLayouts(catalog: Layout[]) {
  const map = new Map(catalog.map((layout) => [layout.id, layout]));
  for (const layout of catalog) {
    let bodies = 0;
    visitBlocks(layout.blocks, (block) => { if (block.type === 'entry-body') bodies++; });
    if (layout.kind === 'template' && bodies !== 1) throw new WeavaError(`模板“${layout.label}”需要且只能有一个内容正文区块。`);
    if (layout.kind !== 'template' && bodies) throw new WeavaError('共享区域和组合不能包含内容正文占位。');
    const walk = (current: Layout, path: Set<string>) => {
      if (path.has(current.id)) throw new WeavaError('共享区域形成循环：' + [...path, current.id].join(' → '));
      const next = new Set(path).add(current.id);
      visitBlocks(current.blocks, (block) => {
        if (block.type !== 'shared') return;
        const target = map.get(block.props.layoutId);
        if (!target || target.kind !== 'region') throw new WeavaError('引用的共享区域不存在：' + block.props.layoutId);
        walk(target, next);
      });
    };
    walk(layout, new Set());
  }
}
export function saveLayout(site: Site, value: Layout, revision: number | null) {
  const layout = layoutSchema.parse(value);
  site.validateBlocks(layout.blocks);
  const current = site.store.get('layout', layout.id);
  if (current && current.value.kind !== layout.kind) throw new WeavaError('已有布局不能改变种类。');
  const catalog = layouts(site).map((row) => row.value as Layout).filter((item) => item.id !== layout.id);
  validateLayouts([...catalog, layout]);
  return site.store.put('layout', layout.id, layout, revision);
}
export function copyPattern(layout: Layout): Block[] {
  const blocks = structuredClone(layout.blocks);
  visitBlocks(blocks, (block) => { block.id = crypto.randomUUID(); });
  return blocks;
}
