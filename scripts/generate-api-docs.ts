import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiReferenceMarkdown } from '../packages/contracts/src/api-reference.ts';
const path=resolve(import.meta.dirname,'../docs/api-reference.md'),value=apiReferenceMarkdown();
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==value)throw new Error('API 文档未同步，请运行 scripts/generate-api-docs.ts。');}
else writeFileSync(path,value);
console.log(JSON.stringify({apiReference:path,checked:process.argv.includes('--check')}));
