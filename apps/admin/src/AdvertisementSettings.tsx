import { advertisementSlots, type Advertisements } from '@weava/contracts';

export function AdvertisementSettings({
  value,
  onChange,
}: {
  value: Advertisements | undefined;
  onChange: (value: Advertisements) => void;
}) {
  return (
    <section className="form-card advertisement-settings">
      <h2>广告</h2>
      <p>网页广告显示在页头导航下方、页脚上方；文章广告显示在文章内容前后。支持 HTML、CSS 和广告脚本，发布设置后生效。</p>
      <div className="advertisement-editors">
        {advertisementSlots.map(({ id, label }) => {
          const slot = value?.[id] ?? { enabled: false, html: '' };
          return (
            <fieldset key={id}>
              <legend>{label}</legend>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={slot.enabled}
                  onChange={(event) =>
                    onChange({ ...value, [id]: { ...slot, enabled: event.target.checked } })
                  }
                />
                启用{label}广告
              </label>
              <label>
                HTML 代码
                <textarea
                  aria-label={`${label}广告 HTML 代码`}
                  className="advertisement-code"
                  rows={8}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  value={slot.html}
                  placeholder={'<a href="https://example.com" style="display:block;padding:24px;text-align:center;background:#f0f3ed">广告内容</a>'}
                  onChange={(event) =>
                    onChange({ ...value, [id]: { ...slot, html: event.target.value } })
                  }
                />
              </label>
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}
