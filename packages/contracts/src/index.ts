import { z } from 'zod';
export * from './blocks.ts';
export * from './analytics.ts';
export const VERSION = '0.1.0';
export const API_VERSION = 1;
export const schemaTypes = ['Article', 'TechArticle', 'WebPage', 'CollectionPage', 'AboutPage', 'ProfilePage', 'Product', 'SoftwareApplication', 'CreativeWork'] as const;
export const seoSchema = z.object({
  title: z.string().max(300).optional(), description: z.string().max(2000).optional(),
  canonical: z.string().optional(), image: z.string().optional(), imageAlt: z.string().optional(),
  schemaType: z.enum(schemaTypes).optional(), authorType: z.enum(['Person', 'Organization']).optional(), authorUrl: z.string().optional(),
});
export const siteSeoSchema = z.object({
  publisherType: z.enum(['Person', 'Organization']).optional(), publisherName: z.string().optional(),
  publisherUrl: z.string().optional(), image: z.string().optional(), sameAs: z.array(z.string()).max(30).optional(),
});
export const evidenceSchema = z.object({
  id: z.string().min(1), claim: z.string().default(''), title: z.string().default(''), url: z.string().default(''),
  status: z.enum(['pending', 'verified']).default('pending'), verifiedAt: z.string().optional(), validUntil: z.string().optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;
export type Seo = z.infer<typeof seoSchema>;
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
    filterable: z.boolean().optional(),
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
  filterable?: boolean;
  fields?: FieldDefinition[];
}
export const typeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1),
  fields: z.array(fieldSchema),
  pathPrefix: z.string().default('/posts/'),
  template: z.string().default('article'),
  schemaType: z.enum(schemaTypes).optional(),
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
  bindings?: Record<string, { source: 'entry' | 'field' | 'site'; key: string }>;
  style?: {
    width?: 'normal' | 'wide' | 'full'; align?: 'left' | 'center' | 'right';
    padding?: number; gap?: number; background?: string;
    columns?: { desktop: number; tablet: number; mobile: number };
  };
}
export const blockSchema: z.ZodType<Block> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    props: z.record(z.string(), z.any()).default({}),
    children: z.array(blockSchema).optional(),
    bindings: z.record(z.string(), z.object({ source: z.enum(['entry', 'field', 'site']), key: z.string().min(1) })).optional(),
    style: z.object({ width: z.enum(['normal', 'wide', 'full']).optional(), align: z.enum(['left', 'center', 'right']).optional(),
      padding: z.number().min(0).max(160).optional(), gap: z.number().min(0).max(120).optional(),
      background: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
      columns: z.object({ desktop: z.number().int().min(1).max(6), tablet: z.number().int().min(1).max(4), mobile: z.number().int().min(1).max(2) }).optional() }).optional(),
  }),
);
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)), '日期无效');
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
  termIds: z.object({ categories: z.array(z.string()), tags: z.array(z.string()) }).optional(),
  fields: z.record(z.string(), z.any()).default({}),
  document: documentSchema.default({ version: 1, format: 'markdown', source: '' }),
  blocks: z.array(blockSchema).default([]),
  template: z.string().optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  visibility: z.enum(['public', 'private']).default('public'),
  indexable: z.boolean().default(true),
  createdAt: timestamp.optional(),
  updatedAt: timestamp.optional(),
  publishedAt: timestamp.optional(),
  compatibility: z.record(z.string(), z.any()).optional(),
  source: z.record(z.string(), z.any()).optional(),
  seo: seoSchema.optional(),
  evidence: z.array(evidenceSchema).max(200).optional(),
});
export type Entry = z.infer<typeof entrySchema>;
export const layoutSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][\w:-]*$/), label: z.string().min(1),
  kind: z.enum(['template', 'region', 'pattern']),
  appliesTo: z.enum(['page', 'content', 'any']).default('any'), blocks: z.array(blockSchema),
});
export type Layout = z.infer<typeof layoutSchema>;
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
export interface Term {
  id: string;
  kind: 'category' | 'tag';
  label: string;
  slug: string;
  parentId?: string;
}
export interface Settings {
  seo?: z.infer<typeof siteSeoSchema>;
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
  taxonomies: { id: string; label: string; description?: string; slug?: string; parentId?: string; kind?: 'category' | 'tag' }[];
  extensions: Record<string, any>;
  sourceUrl: string;
  regions?: { header?: string; before?: string; after?: string; footer?: string };
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
  'entry-heading',
  'entry-body',
  'entry-fields',
  'entry-toc',
  'shared',
  'site-brand',
  'navigation',
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
  redirects?: Record<string, { target: string; entryId?: string }>;
  terms?: Term[];
  layouts?: Layout[];
}
export interface PublishOptions {
  scope?: 'all' | 'entries' | 'settings' | 'layouts' | 'terms';
  ids?: string[];
  label?: string;
  failAt?: string;
  jobId?: string;
  revisions?: Record<string, number>;
  settingsRevision?: number;
  baseReleaseId?: string | null;
  reviewRevision?: number;
  versions?: Record<string, number>;
}
export interface ContentQuery {
  page?: number;
  pageSize?: number;
  kind?: 'content' | 'page';
  type?: string;
  category?: string;
  tag?: string;
  query?: string;
  sort?: 'date' | 'oldest' | 'title';
  fields?: Record<string, string | number | boolean>;
}
export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
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
