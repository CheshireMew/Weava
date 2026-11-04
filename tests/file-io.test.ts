import { expect,it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { digestFile,jsonLines } from '../packages/core/src/file-io.ts';
it('hashes files and iterates JSONL across chunk and UTF-8 boundaries without requiring an EOF newline',()=>{
  const root='D:/Tools/cache/weava/tests/file-io-'+Date.now();mkdirSync(root,{recursive:true});
  const rows=[{id:1,text:'字😀'.repeat(30000)},{id:2,text:'尾行'}],contents=rows.map(row=>JSON.stringify(row)).join('\n\n');
  const file=join(root,'data.jsonl');writeFileSync(file,contents);
  expect(digestFile(file)).toBe(createHash('sha256').update(contents).digest('hex'));
  expect([...jsonLines(file)]).toEqual(rows);
  const partial=jsonLines(file);expect(partial.next().value).toEqual(rows[0]);partial.return(undefined);
});
