import { load } from 'cheerio';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CryptoState } from './state.ts';
import { escape } from './html.ts';
import { configFor, normalize, providerLabels } from './referrals.ts';
import { stockPublic } from './equity-catalog.ts';
export function cryptoBlocks(state: CryptoState) {
  return {
    blocks: {
      'crypto-blacknico:stocks': (_block: any, release: any) => {
        const file = join(state.root, 'extensions/templates/stocks.html');
        if (!existsSync(file)) return '<p>股票目录尚未配置。</p>';
        const $ = load(readFileSync(file, 'utf8'), null, false),
          data = stockPublic(state, release);
        $('#eq-count').text('共 ' + (data.items?.length ?? 0) + ' 个标的');
        $('#eq-list').html(
          (data.items ?? [])
            .slice(0, 50)
            .map(
              (item: any) =>
                '<details class="eq-stock"><summary><strong>' +
                escape(item.ticker) +
                '</strong> ' +
                escape(item.name_zh || item.name) +
                '</summary><div class="eq-products">' +
                (item.offerings ?? [])
                  .map(
                    (o: any) =>
                      '<a class="eq-product" href="' +
                      escape(o.url) +
                      '" rel="sponsored noopener" target="_blank">' +
                      escape(o.platform + ' ' + o.product + ' ' + o.symbol) +
                      '</a>',
                  )
                  .join('') +
                '</div></details>',
            )
            .join(''),
        );
        return (
          '<link rel="stylesheet" href="/equities.css">' +
          $.html() +
          '<script src="/equities.js" defer></script>'
        );
      },
      'crypto-blacknico:referrals': (block: any, release: any) =>
        '<section class="section wrap"><div class="referral-grid">' +
        (block.props.providers ?? [])
          .map((id: string) => {
            const item = configFor(release).referrals?.[id];
            if (!item) return '';
            const display = block.props.items?.find((row: any) => row.provider === id) ?? {};
            const codes = display.codes?.length
              ? display.codes
              : [
                  { key: 'code', label: id.endsWith('-web3') ? 'Web3 邀请码' : '邀请码' },
                  ...(item.futuresCode ? [{ key: 'futuresCode', label: '合约邀请码' }] : []),
                ];
            return (
              '<section class="referral" data-provider="' +
              escape(id) +
              '"><h3>' +
              escape(display.title || item.name || providerLabels[id] || id) +
              '</h3>' +
              (display.description ?? [])
                .map((text: string) => '<p>' + escape(text) + '</p>')
                .join('') +
              '<a class="button lime" href="' +
              escape(item.url) +
              '" rel="sponsored noopener" target="_blank">' +
              escape(display.actionLabel || '前往平台 ↗') +
              '</a><div class="referral-codes">' +
              codes
                .filter((code: any) => item[code.key])
                .map(
                  (code: any) =>
                    '<div class="invite-row"><span>' +
                    escape(code.label) +
                    '</span><button aria-label="复制' +
                    escape(code.label) +
                    ' ' +
                    escape(item[code.key]) +
                    '" data-crypto-copy="' +
                    escape(item[code.key]) +
                    '">' +
                    escape(item[code.key]) +
                    ' ⧉</button></div>',
                )
                .join('') +
              '</div>' +
              (display.note
                ? '<small class="referral-note">' + escape(display.note) + '</small>'
                : '') +
              '</section>'
            );
          })
          .join('') +
        '</div></section><script src="/crypto-business.js" defer></script>',
      'crypto-blacknico:announcements': (_block: any, release: any) =>
        '<section class="wrap announcements-page"><div class="announcements-widget" data-announcements data-compact="false" data-limit="8"><div class="announcement-filters" aria-label="筛选官方公告">' +
        [
          ['all', '全部栏目'],
          ['binance', '币安'],
          ['okx', 'OKX'],
          ['events', '最新活动'],
        ]
          .map(
            ([id, label]) =>
              '<button data-announcement-filter="' +
              id +
              '" aria-pressed="' +
              (id === 'all') +
              '">' +
              label +
              '</button>',
          )
          .join('') +
        '</div><p data-announcements-status class="announcements-status" role="status" hidden></p><div class="announcements-grid">' +
        (state.feeds.feeds ?? [])
          .map(
            (feed: any) =>
              '<section class="announcement-feed" data-announcement-feed="' +
              escape(feed.id) +
              '" data-platform="' +
              escape(feed.platform) +
              '" id="' +
              escape(feed.id) +
              '"><div class="announcement-feed-heading"><h3>' +
              escape(feed.name || feed.id) +
              '</h3><a class="announcement-source" href="' +
              escape(normalize(feed.url, configFor(release))) +
              '" rel="sponsored noopener" target="_blank">官网 ↗</a></div><p class="announcement-updated" data-feed-status>' +
              escape(feed.updatedAt || '尚未更新') +
              '</p><ul class="announcement-list" data-feed-list>' +
              (feed.items ?? [])
                .slice(0, 8)
                .map(
                  (item: any) =>
                    '<li><a href="' +
                    escape(normalize(item.url, configFor(release))) +
                    '" target="_blank" rel="sponsored noopener">' +
                    escape(item.title) +
                    '</a><time>' +
                    escape(item.date || '') +
                    '</time></li>',
                )
                .join('') +
              '</ul><p data-feed-empty hidden>暂无公告</p><button data-feed-more="' +
              escape(feed.id) +
              '" class="announcement-more">显示更多公告 ↓</button></section>',
          )
          .join('') +
        '</div></div></section><script src="/announcements.js" defer></script>',
    },
    transformHtml(html: string, release: any) {
      const $ = load(html),
        config = configFor(release);
      $('a[href^="http"]').each((_i, el) => {
        const a = $(el);
        a.attr('href', normalize(a.attr('href')!, config));
      });
      if ($('video[data-video-key]').length)
        $('body').append('<script src="/crypto-business.js" defer></script>');
      return $.html();
    },
  };
}
