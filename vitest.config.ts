import { defineConfig } from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  resolve:{alias:{'astro:middleware':fileURLToPath(new URL('./tests/fixtures/astro-middleware.ts',import.meta.url))}},
  test: { include: ['tests/**/*.test.{ts,tsx}'], testTimeout: 30000, fileParallelism: false },
});
