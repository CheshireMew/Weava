import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 4322, host: '127.0.0.1' },
  vite: {
    resolve: {
      alias: {
        '@weava/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
        '@weava/contracts': fileURLToPath(
          new URL('../../packages/contracts/src/index.ts', import.meta.url),
        ),
      },
    },
    ssr: { external: ['better-sqlite3', 'sharp'] },
  },
  build: { inlineStylesheets: 'never' },
});
