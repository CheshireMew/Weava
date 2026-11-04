import { useEffect, useState } from 'react';
import { PanelSections } from './PanelSections.tsx';

import { defaultSettings, type Settings } from '@weava/contracts';

import { NavigationEditor } from './NavigationEditor.tsx';
import { AdvertisementSettings } from './AdvertisementSettings.tsx';

import { Fields } from './Fields.tsx';

import { useManagedRecord } from './EditSessions.tsx';

import { SiteSeoFields } from './SeoFields.tsx';
import { useSelectors } from './Selectors.tsx';
import { SiteInfoSettings } from './SiteInfoSettings.tsx';
import type { SiteInfo } from '../../../packages/contracts/src/site-info.ts';
import TaxonomyManager, { useTaxonomyEditor } from './TaxonomyManager.tsx';
import { CategoryDirectory } from './SiteSettingControls.tsx';

const emptyTerms: any[] = [];
const unchanged = async () => {};

function SettingChoice({ label, value, choices, onChange }: {
  label: string; value: string; choices: Record<string, string>; onChange: (value: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  const showCustom = custom || !Object.hasOwn(choices, value);
  return <div><label>{label}<select value={showCustom ? '__custom__' : value} onChange={event => {
    setCustom(event.target.value === '__custom__');
    if (event.target.value !== '__custom__') onChange(event.target.value);
  }}>{Object.entries(choices).map(([key, name]) => <option key={key} value={key}>{name}</option>)}<option value="__custom__">自定义…</option></select></label>
    {showCustom && <label>自定义{label}<input value={value} onChange={event => onChange(event.target.value)} /></label>}
  </div>;
}

export default function SettingsPanel({
  row,
  themes,
  panels,
  layouts,
  save,
  publish,
  onError,
  siteInfo,
  terms = emptyTerms,
  refresh = unchanged,
  initialSection,
}: {
  row: any;
  themes: any[];
  panels: any[];
  layouts: any[];
  save: (v: Settings, r: number) => Promise<any>;
  publish: () => any;
  onError: (s: string) => void;
  siteInfo?: SiteInfo;
  terms?: any[];
  refresh?: () => Promise<any>;
  initialSection?: string;
}) {
  const selectors = useSelectors();
  const taxonomy = useTaxonomyEditor(terms, refresh);
  const [saving, setSaving] = useState(false);
  const managed = useManagedRecord<any>(
    row,
    (value) => save(value.value, value.revision),
    '网站设置',
  );
  const value: Settings = managed.record!.value;
  useEffect(() => {
    managed.session.receive(row);
  }, [row]);
  const set = (p: Partial<Settings>) =>
    managed.setRecord((record: any) => ({ ...record, value: { ...record.value, ...p } }));
  async function saveSettings(publishAfter = false) {
    setSaving(true);
    try {
      await taxonomy.save();
      await managed.session.save();
      if (publishAfter) await publish();
    } catch (error: any) { onError(error.message); }
    finally { setSaving(false); }
  }
  return (
    <div className="panel">
      <div className="panel-title">
        <div>
          <h1>网站设置</h1>
          <p>保存为工作稿，发布后更新网站。</p>
        </div>
        <div>
          <button disabled={saving || taxonomy.busy} onClick={() => void saveSettings()}>
            保存设置
          </button>
          <button
            className="primary"
            disabled={saving || taxonomy.busy}
            onClick={() => void saveSettings(true)}
          >
            发布设置
          </button>
        </div>
      </div>
      <PanelSections label="网站设置分类" initialSection={initialSection} sections={[
        { id: 'site', label: '基本信息', content: <>
        <section className="form-card">
          <h2>网站</h2>
          {[
            ['name', '名称'],
            ['description', '介绍'],
            ['domain', '正式网址'],
            ['footer', '页脚文字'],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={(value as any)[key] ?? ''}
                onChange={(e) => set({ [key]: e.target.value })}
              />
            </label>
          ))}
          <div className="form-columns site-locale">
            <SettingChoice label="语言" value={value.language} choices={{ 'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English', 'en-US': 'English (US)', ja: '日本語' }} onChange={language => set({ language })} />
            <SettingChoice label="时区" value={value.timezone} choices={{ 'Asia/Shanghai': '北京时间', 'Asia/Hong_Kong': '香港时间', 'Asia/Taipei': '台北时间', 'Asia/Tokyo': '东京时间', UTC: '协调世界时', 'America/New_York': '纽约时间', 'Europe/London': '伦敦时间' }} onChange={timezone => set({ timezone })} />
          </div>
          <div className="site-logo"><span>网站标志</span>
            {value.logo && <img src={value.logo} alt="网站标志" />}
            <button type="button" onClick={async () => { const media = await selectors.media('image'); if (media) set({ logo: media.url }); }}>选择图片</button>
            <details className="settings-disclosure"><summary>使用图片地址</summary>
              <label>标志图片地址<input value={value.logo ?? ''} onChange={event => set({ logo: event.target.value })} /></label>
            </details>
          </div>
        </section>
</> },
        { id: 'about', label: '关于本站', content: <SiteInfoSettings section="about" value={value.siteInfo} defaults={siteInfo} onChange={siteInfo => set({ siteInfo })} /> },
        { id: 'friends', label: '友情链接', content: <SiteInfoSettings section="friends" value={value.siteInfo} defaults={siteInfo} onChange={siteInfo => set({ siteInfo })} /> },
        { id: 'appearance', label: '外观', content: <>        <section className="form-card">
          <h2>主题</h2>
          <label>
            主题
            <select
              aria-label="主题"
              value={value.theme}
              onChange={(e) =>
                set({
                  theme: e.target.value,
                  themeSettings: { ...value.themeSettings, [value.theme]: value.themeConfig },
                  themeConfig: value.themeSettings?.[e.target.value] ?? defaultSettings.themeConfig,
                })
              }
            >
              {themes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {[
            ['accent', '强调色', 'color'],
            ['background', '背景色', 'color'],
            ['width', '页面宽度', 'number'],
            ['radius', '圆角', 'number'],
            ['spacing', '区块间距', 'number'],
          ].map(([key, label, type]) => (
            <label key={key}>
              {label}
              <input
                type={type}
                value={(value.themeConfig as any)[key]}
                onChange={(e) =>
                  set({
                    themeConfig: {
                      ...value.themeConfig,
                      [key]: type === 'number' ? Number(e.target.value) : e.target.value,
                    },
                  })
                }
              />
            </label>
          ))}
          <SettingChoice label="字体" value={value.themeConfig.font} choices={{ 'system-ui': '系统字体', 'system-ui, sans-serif': '系统无衬线字体', sans: '无衬线字体', serif: '衬线字体', monospace: '等宽字体' }} onChange={font => set({ themeConfig: { ...value.themeConfig, font } })} />
        </section>
        {value.theme === 'newsletter' && (
          <section className="form-card">
            <h2>首页侧栏</h2>
            <label>
              RSS 订阅下方 HTML
              <textarea
                className="advertisement-code"
                rows={10}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                value={value.extensions.newsletter?.sidebarHtml ?? ''}
                onChange={(event) =>
                  set({
                    extensions: {
                      ...value.extensions,
                      newsletter: {
                        ...value.extensions.newsletter,
                        sidebarHtml: event.target.value,
                      },
                    },
                  })
                }
              />
            </label>
          </section>
        )}
        {value.theme === 'newsletter' && (
          <section className="form-card">
            <h2>文章目录</h2>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={value.extensions.newsletter?.tocDefaultOpen === true}
                onChange={(e) =>
                  set({
                    extensions: {
                      ...value.extensions,
                      newsletter: {
                        ...value.extensions.newsletter,
                        tocDefaultOpen: e.target.checked,
                      },
                    },
                  })
                }
              />
              默认展开侧边目录
            </label>
          </section>
        )}
</> },
        { id: 'navigation', label: '导航与分类', content: <>
        <TaxonomyManager model={taxonomy} onError={onError} />
        <section className="form-card">
          <h2>导航</h2>
          <NavigationEditor
            value={value.navigation}
            onChange={(navigation) => set({ navigation })}
          />
          <CategoryDirectory terms={taxonomy.catalog} value={value.taxonomies} onChange={taxonomies => set({ taxonomies })} />
        </section>
</> },
        { id: 'sharing', label: '搜索与分享', content: <>        <SiteSeoFields value={value} onChange={set} />
</> },
        { id: 'ads', label: '广告', content: <>        <AdvertisementSettings
          value={value.advertisements}
          onChange={(advertisements) => set({ advertisements })}
        />
</> },
        { id: 'advanced', label: '高级', content: <><section className="form-card"><h2>项目资料</h2><label>项目源代码地址<input value={value.sourceUrl ?? ''} onChange={event => set({ sourceUrl: event.target.value })} /></label></section>        {panels
          .filter((panel) => !panel.themes?.length || panel.themes.includes(value.theme))
          .map((panel) => (
            <section className="form-card" key={panel.id}>
              <h2>{panel.label}</h2>
              <Fields
                definitions={panel.fields}
                values={value.extensions[panel.id] ?? {}}
                onChange={(v) => set({ extensions: { ...value.extensions, [panel.id]: v } })}
              />
            </section>
          ))}
</> },
      ]} />

    </div>
  );
}
