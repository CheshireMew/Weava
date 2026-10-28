import { z } from 'zod';
export const VERSION = '0.1.0';
export const API_VERSION = 1;
export const fieldSchema: z.ZodType<FieldDefinition> = z.lazy(() =>
  z.object({
    key: z.string().regex(/^[a-zA-Z][\w-]*$/),
    label: z.string().min(1),
    type: z.enum([
      'text',
      'richtext',
      'number',
      'boolean',
      'date',
      'select',
      'media',
      'reference',
      'group',
    ]),
    required: z.boolean().optional(),
    multiple: z.boolean().optional(),
    options: z.array(z.string()).optional(),
    fields: z.array(fieldSchema).optional(),
  }),
);
export interface FieldDefinition {
  key: string;
  label: string;
  type:
    | 'text'
    | 'richtext'
    | 'number'
    | 'boolean'
    | 'date'
    | 'select'
    | 'media'
    | 'reference'
    | 'group';
  required?: boolean;
  multiple?: boolean;
  options?: string[];
  fields?: FieldDefinition[];
}
export const typeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1),
  fields: z.array(fieldSchema),
  pathPrefix: z.string().default('/posts/'),
  template: z.string().default('article'),
});
export type ContentType = z.infer<typeof typeSchema>;
export const documentSchema = z.discriminatedUnion('format', [
  z.object({ version: z.literal(1), format: z.literal('markdown'), source: z.string() }),
  z.object({
    version: z.literal(1),
    format: z.literal('lexical'),
    source: z.record(z.string(), z.unknown()),
  }),
  z.object({ version: z.literal(1), format: z.literal('html'), source: z.string() }),
]);
export type Document = z.infer<typeof documentSchema>;
export interface Block {
  id: string;
  type: string;
  props: Record<string, any>;
  children?: Block[];
}
export const blockSchema: z.ZodType<Block> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    props: z.record(z.string(), z.any()).default({}),
    children: z.array(blockSchema).optional(),
  }),
);
export const entrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['content', 'page']),
  type: z.string().default('post'),
  title: z.string().min(1).max(300),
  path: z.string().startsWith('/'),
  description: z.string().default(''),
  author: z.string().default(''),
  cover: z.string().default(''),
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  fields: z.record(z.string(), z.any()).default({}),
  document: documentSchema.default({ version: 1, format: 'markdown', source: '' }),
  blocks: z.array(blockSchema).default([]),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  visibility: z.enum(['public', 'private']).default('public'),
  indexable: z.boolean().default(true),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  publishedAt: z.string().optional(),
  compatibility: z.record(z.string(), z.any()).optional(),
  source: z.record(z.string(), z.any()).optional(),
});
export type Entry = z.infer<typeof entrySchema>;
export interface Revision<T> {
  id: string;
  revision: number;
  value: T;
  updatedAt: string;
  published?: boolean;
  hasChanges?: boolean;
}
export interface Navigation {
  label: string;
  url: string;
  children?: Navigation[];
}
export interface Settings {
  name: string;
  domain: string;
  language: string;
  timezone: string;
  description: string;
  logo: string;
  theme: string;
  navigation: Navigation[];
  footer: string;
  themeConfig: {
    accent: string;
    background: string;
    font: string;
    width: number;
    radius: number;
    spacing: number;
  };
  taxonomies: { id: string; label: string; description?: string }[];
  extensions: Record<string, any>;
  sourceUrl: string;
}
export const defaultSettings: Settings = {
  name: 'Weava',
  domain: 'http://localhost:4322',
  language: 'zh-CN',
  timezone: 'Asia/Shanghai',
  description: '让内容有自己的空间。',
  logo: '',
  theme: 'weava',
  navigation: [
    { label: '文章', url: '/blog/' },
    { label: '作品', url: '/work/' },
    { label: '文档', url: '/docs/' },
    { label: '资源', url: '/resources/' },
  ],
  footer: '用 Weava 构建',
  themeConfig: {
    accent: '#315c4c',
    background: '#f6f5f0',
    font: 'system-ui, sans-serif',
    width: 1180,
    radius: 16,
    spacing: 24,
  },
  taxonomies: [],
  extensions: {},
  sourceUrl: '',
};
export const blockTypes = [
  'text',
  'richtext',
  'hero',
  'button',
  'image-text',
  'container',
  'columns',
  'image',
  'gallery',
  'video',
  'attachment',
  'content-list',
  'cards',
  'taxonomy',
  'content-detail',
  'faq',
  'callout',
  'divider',
  'spacer',
  'compatibility',
];
export interface PublishedEntry extends Entry {
  html: string;
  modifiedAt: string;
  revisionId: number;
}
export interface Release {
  id: string;
  createdAt: string;
  settings: Settings;
  entries: PublishedEntry[];
  types: ContentType[];
  label: string;
}
export interface Job {
  id: string;
  operation: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'recovery_required';
  createdAt: string;
  updatedAt: string;
  message: string;
  result?: any;
  payload?: any;
  workerPid?: number;
}
export class WeavaError extends Error {
  constructor(
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'WeavaError';
  }
}
