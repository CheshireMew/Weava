import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Keep the editable source tree complete when an extension is installed. */
export function installCryptoSource(
  source: string,
  destination: string,
  entry: 'index' | 'legacy',
) {
  mkdirSync(destination, { recursive: true });
  cpSync(source, join(destination, 'crypto-src'), { recursive: true });
  writeFileSync(
    join(destination, 'index.ts'),
    `export { default } from './crypto-src/${entry}.ts';\n`,
  );
}
