import { expect, it } from 'vitest';
import { staticAdvertisement } from '../apps/web/src/advertisement-rendering.ts';

it('renders a text banner with its styles and links without waiting for an iframe', () => {
  const html = '<style>.offer{display:flex;flex-wrap:wrap;padding:8px;border:1px solid #ddd}@media(max-width:600px){.offer{display:block}}</style><div class="offer"><strong>优惠</strong><a href="https://example.com/offer" target="_blank" rel="sponsored">注册</a></div>';
  const result = staticAdvertisement(html);
  expect(result).toContain('<style>.offer{');
  expect(result).toContain('class="offer"');
  expect(result).toContain('rel="sponsored noopener noreferrer"');
  expect(staticAdvertisement(html)).toBe(result);
});

it('keeps executable and embedded advertisements in their isolated document', () => {
  for (const html of ['<script src="https://example.com/ad.js"></script>', '<div onclick="run()">广告</div>', '<iframe src="https://example.com/"></iframe>', '<svg onload="run()"></svg>', '<link rel="stylesheet" href="https://example.com/ad.css">'])
    expect(staticAdvertisement(html)).toBeNull();
});

it('removes executable URLs from static links', () => {
  expect(staticAdvertisement('<a href="java&#x73;cript:alert(1)">链接</a>')).toBe('<a>链接</a>');
});

it('uses known image geometry in the page and isolates ads with unresolved geometry or fonts', () => {
  expect(staticAdvertisement('<img src="https://example.com/banner.png" width="600" height="80">')).toContain('width="600" height="80"');
  expect(staticAdvertisement('<img src="https://example.com/banner.png">')).toBeNull();
  expect(staticAdvertisement('<style>@import "https://example.com/ad.css";</style><div>广告</div>')).toBeNull();
  expect(staticAdvertisement('<style>@font-face{font-family:ad;src:url(https://example.com/ad.woff2)}</style>')).toBeNull();
});
