import { saveTerm, ensureTerm } from './taxonomy.ts';

import { webUrl } from './seo.ts';
import type { Term } from '@weava/contracts';
import { WeavaError, type Settings, siteSeoSchema, advertisementsSchema } from '@weava/contracts';
import type { Site } from './site.ts';
import { siteInfoSchema } from '../../contracts/src/site-info.ts';
import { sidebarSchema } from '../../contracts/src/site-presentation.ts';
import {normalizePath} from './paths.ts';
import {isReservedContentPath} from '@weava/contracts';
import {mediaUploadLimits} from '../../contracts/src/api-models.ts';
export class SiteSettings {
  constructor(private site: Pick<Site, 'store' | 'settings' | 'terms'>) {}
  settings() {
    return this.site.store.get('settings', 'site')!;
  }
  saveSettings(value: Settings, revision: number) {
    if(value.mediaUploadLimits)value={...value,mediaUploadLimits:mediaUploadLimits.parse(value.mediaUploadLimits)};
    if(value.extensions.notes!==undefined){const path=value.extensions.notes?.path;if(typeof path!=='string'||!path.startsWith('/')||path==='/'||path.includes('?')||path.includes('#')||isReservedContentPath(normalizePath(path)))throw new WeavaError('随笔入口需要使用普通站内页面路径。');value={...value,extensions:{...value.extensions,notes:{...value.extensions.notes,path:normalizePath(path)}}};}
    if (value.sidebar) {
      value = { ...value, sidebar: sidebarSchema.parse(value.sidebar) };
      for (const link of value.sidebar!.links) {
        if (!link.label.trim()) throw new WeavaError('请填写侧栏链接名称。');
        webUrl(link.url, value.domain);
      }
    }
    if (value.siteInfo !== undefined) {
      const info = siteInfoSchema.parse(value.siteInfo);
      for (const role of ['about', 'friends'] as const) {
        const config = info[role];
        if (config && !config.entryId) {
          const legacy = this.site.store.raw.prepare("SELECT id FROM entry_list WHERE kind='page' AND json_extract(summary,'$.path')=? LIMIT 1").get(config.path) as { id: string } | undefined;
          if (legacy) config.entryId = legacy.id;
        }
      }
      value = { ...value, siteInfo: info };
    }
    if (value.advertisements !== undefined)
      value = { ...value, advertisements: advertisementsSchema.parse(value.advertisements) };
    for (const slot of Object.values(value.advertisements ?? {})) {
      if (slot?.content?.url) webUrl(slot.content.url, value.domain);
      if (slot?.content?.image) webUrl(slot.content.image, value.domain);
    }
    const previousSettings = this.site.settings().value as Settings;
    value = {
      ...value,
      themeSettings: {
        ...previousSettings.themeSettings,
        ...value.themeSettings,
        [previousSettings.theme]: previousSettings.themeConfig,
        [value.theme]: value.themeConfig,
      },
    };
    if (value.seo) {
      value = { ...value, seo: siteSeoSchema.parse(value.seo) };
      for (const item of [value.seo?.publisherUrl, value.seo?.image, ...(value.seo?.sameAs ?? [])])
        if (item) webUrl(item, value.domain);
    }
    if (!value.name?.trim()) throw new WeavaError('请填写网站名称。');
    const navigation = (items: Settings['navigation'], depth = 0) => {
      if (!Array.isArray(items) || depth > 5) throw new WeavaError('导航层级最多为六层。');
      for (const item of items) {
        if (!item.label?.trim() || typeof item.url !== 'string')
          throw new WeavaError('导航文字或网址无效。');
        try {
          const url = new URL(item.url, value.domain);
          if (!['http:', 'https:', 'mailto:', 'tel:', 'entry:'].includes(url.protocol))
            throw new Error();
        } catch {
          throw new WeavaError('导航网址无效：' + item.label);
        }
        if (item.children) navigation(item.children, depth + 1);
      }
    };
    navigation(value.navigation);
    try {
      new URL(value.domain);
      new Intl.DateTimeFormat(value.language, { timeZone: value.timezone });
    } catch {
      throw new WeavaError('域名、语言或时区无效。');
    }
    if (
      !/^#[0-9a-f]{6}$/i.test(value.themeConfig.accent) ||
      !/^#[0-9a-f]{6}$/i.test(value.themeConfig.background)
    )
      throw new WeavaError('颜色需要使用六位十六进制格式。');
    if (
      value.themeConfig.width < 600 ||
      value.themeConfig.width > 2400 ||
      value.themeConfig.radius < 0 ||
      value.themeConfig.radius > 80 ||
      value.themeConfig.spacing < 0 ||
      value.themeConfig.spacing > 100
    )
      throw new WeavaError('主题尺寸超出范围。');
    return this.site.store.raw
      .transaction(() => {
        for (const item of value.taxonomies) {
          const current = this.site.store.get('term', item.id);
          if (!current) ensureTerm(this.site, item.label, item.kind ?? 'category', item.id);
          else if (
            current.value.label !== item.label ||
            (item.slug && current.value.slug !== item.slug) ||
            current.value.parentId !== item.parentId
          )
            saveTerm(
              this.site,
              {
                ...current.value,
                label: item.label,
                slug: item.slug ?? current.value.slug,
                parentId: item.parentId,
              },
              current.revision,
            );
        }
        return this.site.store.put('settings', 'site', value, revision);
      })
      .immediate();
  }
  terms() {
    return this.site.store.list('term');
  }
  saveTerm(value: Term, revision: number | null) {
    return this.site.store.raw
      .transaction(() => {
        const saved = saveTerm(this.site, value, revision);
        const settings = this.site.settings();
        if (settings.value.taxonomies.some((term: any) => term.id === value.id))
          this.site.store.put(
            'settings',
            'site',
            {
              ...settings.value,
              taxonomies: settings.value.taxonomies.map((term: any) =>
                term.id === value.id ? { ...term, ...saved.value } : term,
              ),
            },
            settings.revision,
          );
        return saved;
      })
      .immediate();
  }
}
