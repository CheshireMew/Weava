import {
  blockTypes,
  WeavaError,
  type Block,
  validateBlockProps,
  blockDefinitions,
} from '@weava/contracts';
import type { Site } from './site.ts';
export class SiteBlocks {
  constructor(private site: Pick<Site, 'store' | 'extensionBlockDefinitions'>) {}
  validateBlocks(blocks: Block[], publishing = false) {
    const ids = new Set<string>();
    const visit = (items: Block[], depth: number) => {
      if (depth > 12) throw new WeavaError('页面区块嵌套过深。');
      for (const b of items) {
        if (ids.has(b.id)) throw new WeavaError('区块编号重复。');
        ids.add(b.id);
        if (!blockTypes.includes(b.type) && !this.site.store.get('extension-block', b.type))
          throw new WeavaError('未知区块：' + b.type);
        const definition = this.site.extensionBlockDefinitions[b.type] ?? blockDefinitions[b.type];
        const placeholders = Object.fromEntries(
          (definition?.fields ?? [])
            .filter((field) => field.required && b.bindings?.[field.key])
            .map((field) => [field.key, field.control === 'number' ? 0 : '绑定值']),
        );
        try {
          validateBlockProps(b.type, { ...b.props, ...placeholders }, publishing, definition);
        } catch (error: any) {
          throw new WeavaError(error.message, 400, { blockId: b.id, type: b.type });
        }
        if (b.children) visit(b.children, depth + 1);
      }
    };
    visit(blocks, 0);
  }
}
