import { useEffect, useRef, useState } from 'react';
import { PanelSections } from './PanelSections.tsx';

import { defaultSettings, type Settings } from '@weava/contracts';

import { NavigationEditor } from './NavigationEditor.tsx';
import { AdvertisementSettings } from './AdvertisementSettings.tsx';



import { useManagedRecord } from './EditSessions.tsx';

import { SiteSeoFields } from './SeoFields.tsx';
import { useSelectors } from './Selectors.tsx';
import { SiteInfoSettings } from './SiteInfoSettings.tsx';
import type { SiteInfo } from '../../../packages/contracts/src/site-info.ts';
import TaxonomyManager, { useTaxonomyEditor } from './TaxonomyManager.tsx';
import { FeaturedSettings } from './FeaturedSettings.tsx';
import { SidebarSettings } from './SidebarSettings.tsx';
import { AutosaveStatus } from './AutosaveStatus.tsx';
import { settingsSchema } from '../../../packages/contracts/src/api-models.ts';
import { api } from './api.ts';
import { mergeSettingDraft } from './settings-draft.ts';
import type { AutosaveState } from './useAutosave.ts';

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
  onError,
  siteInfo,
  terms = emptyTerms,
  refresh = unchanged,
  initialSection,
  application,
  applyTerms = unchanged,
  contentEnabled = true,
}: {
  row: any;
  themes: any[];
  panels: any[];
  layouts: any[];
  save: (v: Settings, r: number) => Promise<any>;
  onError: (s: string) => void;
  siteInfo?: SiteInfo;
  terms?: any[];
  refresh?: () => Promise<any>;
  initialSection?: string;
  application?: AutosaveState;
  applyTerms?: () => void;
  contentEnabled?: boolean;
}) {
  const selectors = useSelectors();
  const taxonomy = useTaxonomyEditor(terms, refresh, applyTerms);
  const baseline = useRef(row);
  const managed = useManagedRecord<any>(
    row,
    async (snapshot) => {
      try { return await save(snapshot.value, snapshot.revision); }
      catch (error: any) {
        if (error.status !== 409 || baseline.current.revision !== snapshot.revision) throw error;
        const latest = await api('settings');
        return save(mergeSettingDraft(baseline.current.value, snapshot.value, latest.value), latest.revision);
      }
    },
    '网站设置',
    { autosave: { ready: record => settingsSchema.safeParse(record.value).success }, saved: saved => { baseline.current = saved; } },
  );
  const value: Settings = managed.record!.value;
  useEffect(() => {
    if (!managed.session.dirty) baseline.current = row;
    managed.session.receive(row);
  }, [row]);
  const set = (p: Partial<Settings>) =>
    managed.setRecord((record: any) => ({ ...record, value: { ...record.value, ...p } }));
  const saveState = ['error', 'saving', 'incomplete', 'pending'].flatMap(phase => [managed.autoSave, taxonomy.autoSave, application].filter(state => state?.phase === phase))[0] ?? managed.autoSave;
  return (
    <div className="panel">
      <div className="panel-title">
        <h1>网站设置</h1>
      </div>
      {['error', 'incomplete'].includes(saveState.phase) && <div className="settings-save-feedback"><AutosaveStatus state={saveState} label="网站设置" /></div>}
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
            {value.logo && <button type="button" onClick={() => set({ logo: '' })}>移除图片</button>}
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
        </section>
        <FeaturedSettings order={value.featuredOrder} onChange={featuredOrder => set({ featuredOrder })} onError={onError} />
        {value.theme === 'newsletter' && <SidebarSettings value={value} onChange={sidebar => set({ sidebar })} />}
</> },
        { id: 'navigation', label: contentEnabled ? '导航与分类' : '导航', content: <>
        {contentEnabled && <TaxonomyManager model={taxonomy} onError={onError} />}
        <section className="form-card">
          <h2>导航</h2>
          <NavigationEditor
            value={value.navigation}
            onChange={(navigation) => set({ navigation })}
          />
        </section>
</> },
        { id: 'sharing', label: '搜索与分享', content: <>        <SiteSeoFields value={value} onChange={set} />
</> },
        { id: 'ads', label: '广告', content: <>        <AdvertisementSettings
          value={value.advertisements}
          onChange={(advertisements) => set({ advertisements })}
        />
</> },
      ]} />

    </div>
  );
}
