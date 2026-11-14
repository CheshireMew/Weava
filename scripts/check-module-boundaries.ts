import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { validationToolsRoot } from './setup-validation.ts';
import { checkModuleSource } from './module-dependencies.ts';

/** Use the parser already installed for template validation, including type-only imports. */
export function checkModuleBoundaries() {
  const require = createRequire(import.meta.url),
    ts = require(join(validationToolsRoot, 'node_modules/typescript/lib/typescript.js'));
  const files: string[] = [];
  function walk(root: string) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const file = join(root, entry.name).replaceAll('\\', '/');
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:tsx?|astro)$/.test(file)) files.push(file);
    }
  }
  for (const root of [
    'packages/core/src',
    'packages/contracts/src',
    'packages/runtime-common/src',
    'packages/manager/src',
    'packages/cli/src',
    'packages/site-runtime/src',
    'packages/crypto-extension/src',
    'packages/crypto-migration/src',
    'apps/admin/src',
    'apps/web/src',
  ])
    walk(root);
  const paths = new Set(files),
    edges = new Map<string, string[]>();
  for (const file of files) {
    const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true),
      targets: string[] = [];
    if (file.startsWith('apps/web/src/api/')) {
      const inspect = (node: any) => {
        if (ts.isPropertyAccessExpression(node) && node.name.text === 'store')
          throw new Error('HTTP 接口应通过业务服务访问数据：' + file);
        ts.forEachChild(node, inspect);
      };
      inspect(ast);
    }
    targets.push(...checkModuleSource(file, readFileSync(file, 'utf8'), paths));
    edges.set(file, targets);
  }
  const complete = new Set<string>(),
    active = new Set<string>(),
    stack: string[] = [];
  function visit(file: string) {
    if (active.has(file))
      throw new Error(
        '存在代码循环依赖：' + [...stack.slice(stack.indexOf(file)), file].join(' → '),
      );
    if (complete.has(file)) return;
    active.add(file);
    stack.push(file);
    for (const target of edges.get(file) ?? []) visit(target);
    stack.pop();
    active.delete(file);
    complete.add(file);
  }
  for (const file of files) visit(file);
  console.log(
    `模块依赖检查通过：${files.length} 个源码文件（含 Astro、类型与动态导入），无静态执行依赖环。`,
  );
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename))
  checkModuleBoundaries();
