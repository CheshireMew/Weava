import { z } from 'zod';

export interface BlockControl {
  key: string;
  label: string;
  control: 'text' | 'textarea' | 'number' | 'media' | 'content' | 'url' | 'select';
  options?: string[];
  required?: boolean;
}
export interface BlockDefinition {
  label: string;
  fields: BlockControl[];
  schema: z.ZodType<Record<string, any>>;
}
const string = z.string().optional();
const number = (min: number, max: number) => z.number().finite().min(min).max(max).optional();
const props = (shape: Record<string, z.ZodType>) => z.object(shape).passthrough();
const field = (key: string, label: string, control: BlockControl['control'] = 'text', required = false): BlockControl => ({ key, label, control, required });
const list = { title: string, contentType: string, category: string, tag: string, query: string,
  filters: z.enum(['show', 'hide']).optional(),
  sort: z.enum(['date', 'title', 'oldest']).optional(), limit: number(1, 500), pageKey: string,
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional() };
export const blockDefinitions: Record<string, BlockDefinition> = {
  text: { label: '文字', fields: [field('text', '内容', 'textarea')], schema: props({ text: string }) },
  richtext: { label: '正文', fields: [field('text', '内容', 'textarea')], schema: props({ text: string }) },
  hero: { label: '主视觉', fields: [field('eyebrow', '眉题'), field('title', '标题'), field('description', '说明', 'textarea'), field('buttonLabel', '按钮文字'), field('buttonUrl', '按钮网址', 'url'), field('image', '图片', 'media')],
    schema: props({ eyebrow: string, title: string, description: string, buttonLabel: string, buttonUrl: string, image: string, alt: string }) },
  button: { label: '按钮', fields: [field('label', '文字'), field('url', '网址', 'url', true)], schema: props({ label: string, url: string }) },
  'image-text': { label: '图文', fields: [field('title', '标题'), field('text', '正文', 'textarea'), field('src', '图片', 'media', true), field('alt', '图片说明')], schema: props({ title: string, text: string, src: string, alt: string }) },
  container: { label: '分组', fields: [], schema: props({}) },
  columns: { label: '多列', fields: [field('columns', '列数', 'number')], schema: props({ columns: z.number().int().min(1).max(4).optional() }) },
  image: { label: '图片', fields: [field('src', '图片', 'media', true), field('alt', '图片说明'), field('caption', '图注')], schema: props({ src: string, alt: string, caption: string }) },
  gallery: { label: '画廊', fields: [], schema: props({ images: z.array(z.union([z.string(), props({ src: z.string(), alt: string, caption: string })])).optional() }) },
  video: { label: '视频', fields: [field('src', '播放地址', 'media', true), field('poster', '封面', 'media'), field('caption', '说明')], schema: props({ src: string, poster: string, caption: string }) },
  attachment: { label: '附件', fields: [field('url', '附件', 'media', true), field('label', '文字')], schema: props({ url: string, label: string }) },
  'content-list': { label: '内容列表', fields: [field('title', '标题'), field('contentType', '内容类型'), field('category', '分类'), field('tag', '标签'), field('query', '关键词'), { ...field('sort', '排序', 'select'), options: ['date', 'title', 'oldest'] }, { ...field('filters', '访客筛选', 'select'), options: ['show', 'hide'] }, field('limit', '每页数量', 'number')], schema: props(list) },
  cards: { label: '卡片列表', fields: [field('title', '标题'), field('contentType', '内容类型'), { ...field('filters', '访客筛选', 'select'), options: ['show', 'hide'] }, field('limit', '每页数量', 'number')], schema: props(list) },
  taxonomy: { label: '分类目录', fields: [field('basePath', '分类入口', 'url')], schema: props({ basePath: string }) },
  'content-detail': { label: '正文引用', fields: [field('entryId', '内容', 'content')], schema: props({ entryId: string }) },
  faq: { label: '常见问题', fields: [], schema: props({ items: z.array(props({ question: z.string(), answer: z.string() })).optional() }) },
  callout: { label: '提示', fields: [field('title', '标题'), field('text', '正文', 'textarea')], schema: props({ title: string, text: string }) },
  divider: { label: '分隔线', fields: [], schema: props({}) },
  spacer: { label: '留白', fields: [field('height', '高度', 'number')], schema: props({ height: number(0, 240) }) },
  compatibility: { label: '来源兼容内容', fields: [field('html', '来源 HTML', 'textarea')], schema: props({ html: string }) },
  'entry-heading': { label: '内容标题', fields: [{ ...field('cover', '封面', 'select'), options: ['show', 'hide'] }], schema: props({ cover: z.enum(['show', 'hide']).optional() }) },
  'entry-body': { label: '内容正文', fields: [], schema: props({}) },
  'entry-fields': { label: '内容字段', fields: [field('keys', '字段名称，留空显示全部')], schema: props({ keys: string }) },
  'entry-toc':{label:'正文目录',fields:[],schema:props({})},
  shared: { label: '共享区域', fields: [field('layoutId', '共享区域', 'select', true)], schema: props({ layoutId: string }) },
  'site-brand': { label: '网站标识', fields: [], schema: props({}) },
  navigation: { label: '网站导航', fields: [], schema: props({}) },
};

export function validateBlockProps(type: string, value: Record<string, any>, publishing = false, definition = blockDefinitions[type]) {
  if (!definition) return;
  const parsed = definition.schema.safeParse(value);
  if (!parsed.success) throw new Error(`${definition.label}区块参数无效：${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('；')}`);
  if (publishing) for (const f of definition.fields)
    if (f.required && !String(value[f.key] ?? '').trim()) throw new Error(`${definition.label}区块需要填写${f.label}。`);
}
