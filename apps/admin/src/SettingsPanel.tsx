import { useEffect } from 'react';

import { defaultSettings, type Settings } from '@weava/contracts';

import { NavigationEditor } from './NavigationEditor.tsx';
import { AdvertisementSettings } from './AdvertisementSettings.tsx';

import { Fields } from './Fields.tsx';

import { useManagedRecord } from './EditSessions.tsx';

import { SiteSeoFields } from './SeoFields.tsx';
import { useSelectors } from './Selectors.tsx';

export default function SettingsPanel({
  row,
  themes,
  panels,
  layouts,
  save,
  publish,
  onError,
}: {
  row: any;
  themes: any[];
  panels: any[];
  layouts: any[];
  save: (v: Settings, r: number) => Promise<any>;
  publish: () => any;
  onError: (s: string) => void;
}) {
  const selectors = useSelectors();
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
  return (
    <div className="panel">
      <div className="panel-title">
        <div>
          <h1>外观与导航</h1>
          <p>保存为工作稿，发布后更新网站。</p>
        </div>
        <div>
          <button onClick={() => managed.session.save().catch((e) => onError(e.message))}>
            保存设置
          </button>
          <button
            className="primary"
            onClick={async () => {
              try {
                await managed.session.save();
                await publish();
              } catch (e: any) {
                onError(e.message);
              }
            }}
          >
            发布设置
          </button>
        </div>
      </div>
      <div className="settings-panels">
        <AdvertisementSettings
          value={value.advertisements}
          onChange={(advertisements) => set({ advertisements })}
        />
        <SiteSeoFields value={value} onChange={set} />
        <section className="form-card">
          <h2>网站</h2>
          {[
            ['name', '名称'],
            ['description', '介绍'],
            ['domain', '正式网址'],
            ['logo', 'Logo 地址'],
            ['language', '语言'],
            ['timezone', '时区'],
            ['footer', '页脚文字'],
            ['sourceUrl', '项目源代码地址'],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={(value as any)[key] ?? ''}
                onChange={(e) => set({ [key]: e.target.value })}
              />
              {key === 'logo' && <button type="button" onClick={async () => {
                const media = await selectors.media('image');
                if (media) set({ logo: media.url });
              }}>选择图片</button>}
            </label>
          ))}
        </section>
        <section className="form-card">
          <h2>主题</h2>
          {(['header', 'before', 'after', 'footer'] as const).map((position) => (
            <label key={position}>
              {{ header: '页头', before: '正文上方', after: '正文下方', footer: '页脚' }[position]}
              <select
                value={value.regions?.[position] ?? ''}
                onChange={(event) =>
                  set({
                    regions: { ...value.regions, [position]: event.target.value || undefined },
                  })
                }
              >
                <option value="">使用默认</option>
                {layouts
                  .filter((row) => row.value.kind === 'region')
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.value.label}
                    </option>
                  ))}
              </select>
            </label>
          ))}
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
            ['font', '字体', 'text'],
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
        <section className="form-card">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={value.commentModeration !== false}
              onChange={(event) => set({ commentModeration: event.target.checked })}
            />
            新评论需要审核
          </label>
          <h2>导航</h2>
          <NavigationEditor
            value={value.navigation}
            onChange={(navigation) => set({ navigation })}
          />
        </section>
        <section className="form-card">
          <h2>分类目录</h2>
          {value.taxonomies.map((t, i) => (
            <div className="navigation-row" key={i}>
              <input
                aria-label="分类标识"
                value={t.id}
                onChange={(e) =>
                  set({
                    taxonomies: value.taxonomies.map((v, j) =>
                      i === j ? { ...v, id: e.target.value } : v,
                    ),
                  })
                }
              />
              <input
                aria-label="分类名称"
                value={t.label}
                onChange={(e) =>
                  set({
                    taxonomies: value.taxonomies.map((v, j) =>
                      i === j ? { ...v, label: e.target.value } : v,
                    ),
                  })
                }
              />
            </div>
          ))}
          <button
            onClick={() =>
              set({
                taxonomies: [
                  ...value.taxonomies,
                  { id: 'topic-' + (value.taxonomies.length + 1), label: '新分类' },
                ],
              })
            }
          >
            添加分类
          </button>
        </section>
        {panels
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
      </div>
    </div>
  );
}
