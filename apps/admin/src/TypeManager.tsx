import { Plus } from 'lucide-react';
import { blockDefinitions, schemaTypes, type ContentType } from '@weava/contracts';
import { schemaTypeLabels } from './admin-labels.ts';

import { FieldDefinitions, TypeAdminLayout } from './Fields.tsx';

import { useManagedRecord } from './EditSessions.tsx';

import './style.css';

export default function TypeManager({
  types,
  extensionBlocks,
  templates,
  onSave,
  onError,
}: {
  types: any[];
  extensionBlocks: string[];
  templates: any[];
  onSave: (value: ContentType, revision: number | null) => Promise<any>;
  onError: (s: string) => void;
}) {
  const managed = useManagedRecord<any>(
    types[0] ?? null,
    (row) => onSave(row.value, row.revision),
    '内容类型',
  );
  const selected = managed.record,
    setSelected = managed.setRecord;
  return (
    <div className="panel">
      <div className="panel-title">
        <div>
          <h1>内容类型</h1>
          <p>定义文章、作品或属于你自己的内容。</p>
        </div>
        <button
          className="primary"
          onClick={async () => {
            try {
              await managed.session.save();
              setSelected({
                revision: null,
                value: {
                  id: 'custom-' + Date.now().toString(36),
                  label: '新内容类型',
                  pathPrefix: '/items/',
                  template: 'article',
                  fields: [],
                },
              });
            } catch (error: any) {
              onError(error.message);
            }
          }}
        >
          <Plus size={16} />
          新建类型
        </button>
      </div>
      <div className="split-panel">
        <nav className="object-list">
          {types.map((t) => (
            <button
              key={t.id}
              aria-current={selected?.value.id === t.id ? 'true' : undefined}
              onClick={async () => {
                try {
                  await managed.session.save();
                  managed.session.adopt(t);
                } catch (error: any) {
                  onError(error.message);
                }
              }}
            >
              {t.value.label}
            </button>
          ))}
        </nav>
        {selected && (
          <div className="form-card">
            <label>
              名称
              <input
                value={selected.value.label}
                onChange={(e) =>
                  setSelected({ ...selected, value: { ...selected.value, label: e.target.value } })
                }
              />
            </label>
            <details className="settings-disclosure"><summary>内部标识</summary><label>
              类型标识
              <input
                disabled={!!selected.revision}
                value={selected.value.id}
                onChange={(e) =>
                  setSelected({ ...selected, value: { ...selected.value, id: e.target.value } })
                }
              />
            </label></details>
            <label>
              默认网址前缀
              <input
                value={selected.value.pathPrefix}
                onChange={(e) =>
                  setSelected({
                    ...selected,
                    value: { ...selected.value, pathPrefix: e.target.value },
                  })
                }
              />
            </label>
            <FieldDefinitions
              value={selected.value.fields}
              types={types.map((row) => row.value)}
              onChange={(fields) =>
                setSelected({ ...selected, value: { ...selected.value, fields } })
              }
            />
            <details>
              <summary>正文区块</summary>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={selected.value.allowedBlocks !== undefined}
                  onChange={(event) =>
                    setSelected({
                      ...selected,
                      value: {
                        ...selected.value,
                        allowedBlocks: event.target.checked
                          ? Object.keys(blockDefinitions).filter(
                              (key) => !key.startsWith('entry-') && key !== 'compatibility',
                            )
                          : undefined,
                      },
                    })
                  }
                />
                限制可用区块
              </label>
              {selected.value.allowedBlocks !== undefined && (
                <fieldset>
                  <legend>允许的正文区块</legend>
                  {[
                    ...Object.entries(blockDefinitions)
                      .filter(([key]) => !key.startsWith('entry-') && key !== 'compatibility')
                      .map(([key, value]) => ({ key, label: value.label })),
                    ...extensionBlocks.map((key: string) => ({ key, label: key })),
                  ].map(({ key, label }) => (
                    <label className="checkbox" key={key}>
                      <input
                        type="checkbox"
                        aria-label={'允许区块 ' + label}
                        checked={selected.value.allowedBlocks.includes(key)}
                        onChange={(event) =>
                          setSelected({
                            ...selected,
                            value: {
                              ...selected.value,
                              allowedBlocks: event.target.checked
                                ? [...selected.value.allowedBlocks, key]
                                : selected.value.allowedBlocks.filter(
                                    (value: string) => value !== key,
                                  ),
                            },
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
              )}
            </details>
            <TypeAdminLayout
              type={selected.value}
              onChange={(admin) =>
                setSelected({ ...selected, value: { ...selected.value, admin } })
              }
            />
            <label>
              默认模板
              <select
                value={selected.value.template}
                onChange={(event) =>
                  setSelected({
                    ...selected,
                    value: { ...selected.value, template: event.target.value },
                  })
                }
              >
                {templates
                  .filter((row) => row.value.kind === 'template' && row.value.appliesTo !== 'page')
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.value.label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              搜索引擎中的页面类型
              <select
                value={selected.value.schemaType ?? ''}
                onChange={(event) =>
                  setSelected({
                    ...selected,
                    value: { ...selected.value, schemaType: event.target.value || undefined },
                  })
                }
              >
                <option value="">自动</option>
                {schemaTypes.map((type) => (
                  <option key={type} value={type}>{schemaTypeLabels[type]}</option>
                ))}
              </select>
            </label>
            <button
              className="primary"
              onClick={() =>
                managed.session
                  .save()
                  .then(() => managed.session.adopt(null))
                  .catch((e) => onError(e.message))
              }
            >
              保存类型
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
