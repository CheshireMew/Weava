import { fieldWidgetSchema, validateBlockProps } from '@weava/contracts';
import type { Extension } from './extensions.ts';
import type { Site } from './site.ts';
type Capabilities = Pick<
  Site,
  'fieldWidgets' | 'extensionThemes' | 'extensionBlockDefinitions' | 'blockRenderers'
>;

export function validateCapabilities(
  site: Capabilities,
  ext: Extension,
  active: readonly Extension[],
) {
  const themes = new Set([
    'weava',
    'newsletter',
    'library',
    ...active.flatMap((item) => (item.themes ?? []).map((theme) => theme.id)),
  ]);
  const panels = new Set(active.flatMap((item) => (item.panels ?? []).map((panel) => panel.id)));
  const types = new Set(active.flatMap((item) => (item.contentTypes ?? []).map((type) => type.id)));
  for (const dependency of ext.dependencies ?? [])
    if (!active.some((item) => item.id === dependency.id))
      throw new Error('依赖扩展启动失败：' + dependency.id);
  for (const [id, widget] of Object.entries(ext.fieldWidgets ?? {})) {
    if (!id.startsWith(ext.id + ':') || site.fieldWidgets[id])
      throw new Error('字段输入器编号需要以扩展编号开头且不能重复：' + id);
    const parsed = fieldWidgetSchema.parse(widget);
    if ((parsed.control === 'range') !== (parsed.type === 'number'))
      throw new Error('range 输入器需要数字基础类型，其它输入器需要文字基础类型。');
    if (parsed.pattern) new RegExp(parsed.pattern, 'u');
    site.fieldWidgets[id] = parsed;
  }
  for (const theme of ext.themes ?? [])
    if (themes.has(theme.id)) throw new Error('主题编号重复：' + theme.id);
  for (const panel of ext.panels ?? [])
    if (panels.has(panel.id)) throw new Error('设置面板编号重复：' + panel.id);
  for (const type of ext.contentTypes ?? [])
    if (types.has(type.id)) throw new Error('多个扩展声明了相同内容类型：' + type.id);
}
export function registerCapabilities(
  site: Capabilities,
  ext: Extension,
  active: readonly Extension[],
) {
  site.extensionThemes = active.flatMap((item) => (item.themes ?? []).map((theme) => theme.id));
  for (const [key, renderer] of Object.entries(ext.blocks ?? {})) {
    if (ext.blockDefinitions?.[key])
      site.extensionBlockDefinitions[key] = ext.blockDefinitions[key];
    site.blockRenderers[key] = (block, release, entry) => {
      if (ext.blockDefinitions?.[key])
        validateBlockProps(key, block.props, true, ext.blockDefinitions[key]);
      return renderer(block, release, entry);
    };
    Object.defineProperty(site.blockRenderers[key], Symbol.for('weava.renderer.identity'), {
      value: ext.id + ':' + key + ':' + String(renderer),
    });
  }
}
export function clearCapabilities(site: Capabilities) {
  site.blockRenderers = {};
  site.extensionBlockDefinitions = {};
  site.extensionThemes = [];
  site.fieldWidgets = {};
}
