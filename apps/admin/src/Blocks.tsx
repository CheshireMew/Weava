import { useState } from 'react';
import { Plus, ChevronUp, ChevronDown, Copy, Archive } from 'lucide-react';
import type { Block } from '@weava/contracts';
const labels: Record<string, string> = {
  text: '文字',
  richtext: '正文',
  hero: '主视觉',
  button: '按钮',
  'image-text': '图文',
  container: '分组',
  columns: '多列',
  image: '图片',
  gallery: '画廊',
  video: '视频',
  attachment: '附件',
  'content-list': '内容列表',
  cards: '卡片列表',
  taxonomy: '分类目录',
  'content-detail': '正文引用',
  faq: '常见问题',
  callout: '提示',
  divider: '分隔线',
  spacer: '留白',
  compatibility: '来源兼容内容',
};
const definitions: Record<string, [string, string, string?][]> = {
  'content-detail': [['entryId', '内容编号']],
  text: [['text', '内容', 'textarea']],
  richtext: [['text', '内容', 'textarea']],
  hero: [
    ['eyebrow', '眉题'],
    ['title', '标题'],
    ['description', '说明', 'textarea'],
    ['buttonLabel', '按钮文字'],
    ['buttonUrl', '按钮网址'],
    ['image', '图片地址'],
  ],
  button: [
    ['label', '文字'],
    ['url', '网址'],
  ],
  'image-text': [
    ['title', '标题'],
    ['text', '正文', 'textarea'],
    ['src', '图片地址'],
    ['alt', '图片说明'],
  ],
  columns: [['columns', '列数', 'number']],
  image: [
    ['src', '图片地址'],
    ['alt', '图片说明'],
    ['caption', '图注'],
  ],
  video: [
    ['src', '播放地址'],
    ['poster', '封面地址'],
    ['caption', '说明'],
  ],
  attachment: [
    ['url', '附件网址'],
    ['label', '文字'],
  ],
  'content-list': [
    ['title', '标题'],
    ['contentType', '内容类型'],
    ['category', '分类'],
    ['tag', '标签'],
    ['query', '关键词'],
    ['sort', '排序：date 或 title'],
    ['limit', '数量', 'number'],
  ],
  cards: [
    ['title', '标题'],
    ['contentType', '内容类型'],
    ['limit', '数量', 'number'],
  ],
  callout: [
    ['title', '标题'],
    ['text', '正文', 'textarea'],
  ],
  spacer: [['height', '高度', 'number']],
  compatibility: [['html', '来源 HTML', 'textarea']],
};
export function Blocks({
  value,
  onChange,
}: {
  value: Block[];
  onChange: (value: Block[]) => void;
}) {
  const [selected, setSelected] = useState<string>('');
  const [newType, setNewType] = useState('text');
  const update = (id: string, patch: Partial<Block>) =>
    onChange(value.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const changeProp = (b: Block, key: string, v: any) =>
    update(b.id, { props: { ...b.props, [key]: v } });
  function move(index: number, delta: number) {
    const next = [...value];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  }
  return (
    <div className="block-builder">
      {value.map((b, index) => (
        <section key={b.id} className={'block-row ' + (selected === b.id ? 'selected' : '')}>
          <div className="block-row-head">
            <button
              className="block-select"
              onClick={() => setSelected(selected === b.id ? '' : b.id)}
            >
              {String(index + 1).padStart(2, '0')} <strong>{labels[b.type] ?? b.type}</strong>
              <span>{String(b.props.title ?? b.props.text ?? '').slice(0, 30)}</span>
            </button>
            <button aria-label="上移区块" disabled={!index} onClick={() => move(index, -1)}>
              <ChevronUp size={16} />
            </button>
            <button
              aria-label="下移区块"
              disabled={index === value.length - 1}
              onClick={() => move(index, 1)}
            >
              <ChevronDown size={16} />
            </button>
            <button
              aria-label="复制区块"
              onClick={() => {
                const clone = structuredClone(b);
                const ids = (n: Block) => {
                  n.id = crypto.randomUUID();
                  n.children?.forEach(ids);
                };
                ids(clone);
                onChange([...value.slice(0, index + 1), clone, ...value.slice(index + 1)]);
              }}
            >
              <Copy size={15} />
            </button>
            <button
              aria-label="移除区块"
              onClick={() => onChange(value.filter((v) => v.id !== b.id))}
            >
              <Archive size={15} />
            </button>
          </div>
          {selected === b.id && (
            <div className="block-properties">
              {(definitions[b.type] ?? []).map(([key, label, type]) => (
                <label key={key}>
                  {label}
                  {type === 'textarea' ? (
                    <textarea
                      rows={5}
                      value={b.props[key] ?? ''}
                      onChange={(e) => changeProp(b, key, e.target.value)}
                    />
                  ) : (
                    <input
                      type={type ?? 'text'}
                      value={b.props[key] ?? ''}
                      onChange={(e) =>
                        changeProp(
                          b,
                          key,
                          type === 'number' ? Number(e.target.value) : e.target.value,
                        )
                      }
                    />
                  )}
                </label>
              ))}
              {b.type === 'gallery' && (
                <div>
                  {(b.props.images ?? []).map((image: any, i: number) => (
                    <label key={i}>
                      图片 {i + 1}
                      <input
                        value={image.src ?? image}
                        onChange={(e) =>
                          changeProp(
                            b,
                            'images',
                            b.props.images.map((v: any, j: number) =>
                              j === i ? { src: e.target.value } : v,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                  <button
                    onClick={() =>
                      changeProp(b, 'images', [...(b.props.images ?? []), { src: '', alt: '' }])
                    }
                  >
                    添加图片
                  </button>
                </div>
              )}
              {b.type === 'faq' && (
                <div>
                  {(b.props.items ?? []).map((item: any, i: number) => (
                    <div key={i} className="faq-fields">
                      <label>
                        问题
                        <input
                          value={item.question}
                          onChange={(e) =>
                            changeProp(
                              b,
                              'items',
                              b.props.items.map((v: any, j: number) =>
                                i === j ? { ...v, question: e.target.value } : v,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        回答
                        <textarea
                          value={item.answer}
                          onChange={(e) =>
                            changeProp(
                              b,
                              'items',
                              b.props.items.map((v: any, j: number) =>
                                i === j ? { ...v, answer: e.target.value } : v,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      changeProp(b, 'items', [
                        ...(b.props.items ?? []),
                        { question: '', answer: '' },
                      ])
                    }
                  >
                    添加问题
                  </button>
                </div>
              )}
              {['columns', 'container'].includes(b.type) && (
                <Blocks
                  value={b.children ?? []}
                  onChange={(children) => update(b.id, { children })}
                />
              )}
            </div>
          )}
        </section>
      ))}
      <div className="block-add">
        <select aria-label="区块类型" value={newType} onChange={(e) => setNewType(e.target.value)}>
          {Object.entries(labels)
            .filter(([key]) => key !== 'compatibility')
            .map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
        </select>
        <button
          onClick={() => {
            const id = crypto.randomUUID();
            onChange([...value, { id, type: newType, props: {} }]);
            setSelected(id);
          }}
        >
          <Plus size={15} />
          添加区块
        </button>
      </div>
    </div>
  );
}
