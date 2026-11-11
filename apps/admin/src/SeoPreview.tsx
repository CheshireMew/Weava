import { useEffect, useState } from 'react';
import type { ApiInput, ApiOutput } from '@weava/contracts/api';
import { api } from './api.ts';
import { useDebouncedValue } from './useDebouncedValue.ts';

type Preview = ApiOutput<'seoPreview'>;
type PreviewInput = ApiInput<'seoPreview'>['body'];

export function SeoPreview({ input }: { input: PreviewInput }) {
  const snapshot = JSON.stringify(input);
  const request = useDebouncedValue(snapshot, 350);
  const [result, setResult] = useState<{ request: string; value?: Preview; error?: string }>();
  useEffect(() => {
    let current = true;
    void api('seo/preview', JSON.parse(request)).then(value => {
      if (current) setResult({ request, value });
    }).catch(error => {
      if (current) setResult({ request, error: error.message || '预览暂不可用。' });
    });
    return () => { current = false; };
  }, [request]);
  const busy = result?.request !== snapshot;
  const value = result?.value;
  return <div className="seo-preview" aria-busy={busy}>
    <section aria-label="搜索结果预览" className="seo-preview-card">
      <h3>搜索结果预览</h3>
      {value ? <>
        <p className="seo-preview-address">{value.canonical}</p>
        <p className="seo-preview-title">{value.title}</p>
        <p>{value.description || '暂无摘要'}</p>
        <p className="seo-preview-detail">Google 会自行选择实际显示的标题和摘要。</p>
        {!value.indexable && <p className="seo-preview-detail">当前设置不允许搜索引擎收录这篇内容。</p>}
      </> : <p role="status">{busy ? '正在生成预览…' : result?.error || '预览暂不可用。'}</p>}
    </section>
    {value && <section aria-label="分享卡片预览" className="seo-preview-card seo-preview-share">
      {value.image && <img src={value.image} alt={value.imageAlt} />}
      <div>
        <h3>分享卡片预览</h3>
        <p className="seo-preview-address">{value.siteName}</p>
        <strong>{value.socialTitle}</strong>
        <p>{value.description}</p>
        <p className="seo-preview-detail">转发链接时，分享平台可以用这些信息生成卡片。</p>
      </div>
    </section>}
  </div>;
}
