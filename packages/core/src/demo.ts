import { Site } from './site.ts';
import { entrySchema, defaultSettings, type Block } from '@weava/contracts';
import { uuid } from './storage.ts';
export function seedDemo(site: Site) {
  if (site.store.list('entry').length) return;
  const types = [
    ['post', '文章', '/blog/'],
    ['project', '作品', '/work/'],
    ['doc', '文档', '/docs/'],
    ['resource', '资源', '/resources/'],
  ];
  for (const [id, label, pathPrefix] of types)
    site.saveType(
      {
        id,
        label,
        pathPrefix,
        template: 'article',
        fields: id === 'resource' ? [{ key: 'url', label: '网址', type: 'text' }] : [],
      },
      null,
    );
  const block = (type: string, props: any): Block => ({ id: uuid(), type, props });
  const pages = [
    {
      id: 'home',
      title: '让内容有自己的空间。',
      path: '/',
      blocks: [
        block('hero', {
          eyebrow: 'A space of your own',
          title: '想法值得拥有\n自己的空间。',
          description: '写下见解，展示作品，分享知识。一个网站，可以有很多种可能。',
          buttonLabel: '开始阅读',
          buttonUrl: '/blog/',
        }),
        block('content-list', { title: '最近更新', contentType: 'post', limit: 3 }),
        block('image-text', {
          src: '/media/demo-landscape.svg',
          alt: '抽象绿色山形',
          title: '从一篇文章，到整个网站。',
          text: '内容、布局与外观各有自己的位置。你可以专注表达，也可以按照自己的方式组织页面。',
        }),
      ],
    },
    ...types.map(([id, label, path]) => ({
      id: id + '-index',
      title: label,
      path,
      blocks: [
        block('hero', {
          eyebrow: label,
          title: label,
          description: {
            post: '记录与思考，持续发生。',
            project: '将想法变成看得见的作品。',
            doc: '把经验整理成清晰的路径。',
            resource: '值得收藏的工具与阅读。',
          }[id],
        }),
        block('content-list', { contentType: id, limit: 24 }),
      ],
    })),
    {
      id: 'company',
      title: '关于我们',
      path: '/company/',
      blocks: [
        block('hero', {
          eyebrow: 'Our studio',
          title: '认真做事，清楚表达。',
          description: '一个由内容连接起来的工作室。',
        }),
        {
          id: uuid(),
          type: 'columns',
          props: { columns: 2 },
          children: [
            block('callout', {
              title: '内容与品牌',
              text: '从定位到表达，用清晰的文字和视觉呈现你的业务。',
            }),
            block('callout', {
              title: '设计与开发',
              text: '为企业、创作者与独立团队建立易于维护的网站。',
            }),
          ],
        },
        block('content-list', { title: '近期项目', contentType: 'project', limit: 3 }),
        block('faq', {
          items: [
            { question: '如何开始合作？', answer: '先告诉我们你的目标、内容和时间安排。' },
            { question: '网站可以自行维护吗？', answer: '内容、页面与外观可在管理后台维护。' },
          ],
        }),
        block('button', { label: '联系我们', url: 'mailto:hello@example.com' }),
      ],
    },
    {
      id: 'about',
      title: '关于 Weava',
      path: '/about/',
      blocks: [
        block('richtext', {
          text: '# 一个轻盈的起点\n\nWeava 是开放的通用建站框架。内容由你掌握，网站由你定义。\n\n基于 Astro、React 和 TypeScript，采用 AGPL 3.0 开源。',
        }),
      ],
    },
  ];
  for (const page of pages)
    site.saveEntry(entrySchema.parse({ ...page, kind: 'page', status: 'published' }), null);
  const posts = [
    ['first-light', '第一束光：从一个想法开始', '每个独立网站，都从一个值得分享的念头开始。'],
    ['quiet-design', '留白，是设计的一部分', '让文字和图片拥有呼吸的空间。'],
    ['own-your-content', '把内容留在自己手里', '可迁移的格式，让表达不必依附于某个平台。'],
  ];
  for (const [id, title, description] of posts)
    site.saveEntry(
      entrySchema.parse({
        id,
        kind: 'content',
        type: 'post',
        title,
        description,
        path: '/blog/' + id + '/',
        author: 'Weava',
        cover: '/media/demo-landscape.svg',
        status: 'published',
        document: {
          version: 1,
          format: 'markdown',
          source: `## ${title}\n\n${description}\n\n一个网站的价值，来自你愿意放在这里的东西。可以是记录、作品，也可以是帮助别人少走一点弯路的经验。\n\n> 让工具服务于表达。\n\n## 开始使用\n\n1. 登录管理后台。\n2. 创建自己的内容。\n3. 预览并发布。\n\n| 内容 | 用途 |\n| --- | --- |\n| 文章 | 分享思考 |\n| 页面 | 组织网站 |\n\n\`\`\`ts\nconst site = 'Weava';\n\`\`\`\n`,
        },
      }),
      null,
    );
  for (const [type, id, title] of [
    ['project', 'studio', '工作室视觉系统'],
    ['doc', 'getting-started', '开始使用 Weava'],
    ['resource', 'web-standards', 'Web 平台文档'],
  ])
    site.saveEntry(
      entrySchema.parse({
        id,
        kind: 'content',
        type,
        title,
        path: (types.find((t) => t[0] === type)?.[2] ?? '/') + id + '/',
        status: 'published',
        description: '从内容出发，建立清晰的结构。',
        fields: type === 'resource' ? { url: 'https://developer.mozilla.org/zh-CN/' } : {},
        document: {
          version: 1,
          format: 'markdown',
          source: '## ' + title + '\n\n欢迎来到你的网站。这里是一份可以修改的示例内容。',
        },
      }),
      null,
    );
  site.publish({ label: '通用示例初次发布' });
}
