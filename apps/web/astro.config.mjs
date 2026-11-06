import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { adminDevelopmentPlugin } from './src/admin-development.ts';
import '../../packages/core/src/http-lifecycle.ts';
const adapter = node({ mode: 'standalone' });
const configureAdapter = adapter.hooks['astro:config:done'];
adapter.hooks['astro:config:done'] = (context) => configureAdapter({
  ...context,
  setAdapter(value) {
    context.setAdapter({ ...value, serverEntrypoint: fileURLToPath(new URL('./src/server-entry.ts', import.meta.url)) });
  },
});
export default defineConfig({
  output: 'server',
  ...(process.env.WEAVA_BUILD_CACHE ? { cacheDir: process.env.WEAVA_BUILD_CACHE } : {}),
  ...(process.env.WEAVA_BUILD_OUTPUT ? { outDir: join(process.env.WEAVA_BUILD_OUTPUT, 'web') } : {}),
  adapter,
  server: { port: 4322, host: '127.0.0.1' },
  vite: {
    plugins: [adminDevelopmentPlugin()],
    resolve: {
      alias: {
        '@weava/contracts/api-error': fileURLToPath(new URL('../../packages/contracts/src/api-error.ts', import.meta.url)),
        '@weava/contracts/session-api': fileURLToPath(new URL('../../packages/contracts/src/session-api.ts', import.meta.url)),
        '@weava/contracts/api-client': fileURLToPath(new URL('../../packages/contracts/src/api-client.ts', import.meta.url)),
        '@weava/contracts/api': fileURLToPath(new URL('../../packages/contracts/src/admin-api.ts', import.meta.url)),
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
