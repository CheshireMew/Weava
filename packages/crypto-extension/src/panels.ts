import { providerLabels } from './referrals.ts';
export const panels = [
  {
    id: 'crypto',
    label: '平台与邀请设置',
    fields: [
      {
        key: 'config',
        label: '网站业务配置',
        type: 'group',
        fields: [
          {
            key: 'referrals',
            label: '各平台入口',
            type: 'group',
            fields: ['binance', 'okx', 'bitget', 'binance-web3', 'okx-web3'].map((id) => ({
              key: id,
              label: providerLabels[id] ?? id,
              type: 'group',
              fields: [
                { key: 'url', label: '邀请网址', type: 'text' },
                { key: 'code', label: '邀请码', type: 'text' },
                ...(id === 'binance'
                  ? [{ key: 'futuresCode', label: '合约邀请码', type: 'text' }]
                  : []),
              ],
            })),
          },
        ],
      },
    ],
  },
];
