import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, posix, resolve } from 'node:path';
import { validationToolsRoot } from './setup-validation.ts';

/** Use the parser already installed for template validation, including type-only imports. */
export function checkModuleBoundaries() {
  const require = createRequire(import.meta.url),
    ts = require(join(validationToolsRoot, 'node_modules/typescript/lib/typescript.js'));
  const files: string[] = [];
  function walk(root: string) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const file = join(root, entry.name).replaceAll('\\', '/');
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(file) && !file.endsWith('.d.ts')) files.push(file);
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
    for (const statement of ast.statements) {
      if (
        !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) ||
        !statement.moduleSpecifier
      )
        continue;
      const clause = statement.importClause,
        names = clause?.namedBindings ?? statement.exportClause;
      if (
        statement.isTypeOnly ||
        clause?.isTypeOnly ||
        (!clause?.name &&
          names?.elements?.length &&
          names.elements.every((entry: any) => entry.isTypeOnly))
      )
        continue;
      const specifier = statement.moduleSpecifier.text,
        sub = specifier.slice('@weava/contracts/'.length);
      const base = specifier.startsWith('.')
        ? posix.normalize(posix.join(posix.dirname(file), specifier))
        : specifier === '@weava/core'
          ? 'packages/core/src/index.ts'
          : specifier === '@weava/contracts'
            ? 'packages/contracts/src/index.ts'
            : specifier.startsWith('@weava/contracts/')
              ? 'packages/contracts/src/' + (sub === 'api' ? 'admin-api' : sub) + '.ts'
              : null;
      const target = [base, base + '.ts', base + '.tsx', base + '/index.ts'].find(
        (candidate) => candidate && paths.has(candidate),
      );
      if (!target) continue;
      if (
        (file.startsWith('packages/contracts/') && !target.startsWith('packages/contracts/')) ||
        (file.startsWith('packages/runtime-common/') &&
          !target.startsWith('packages/runtime-common/') &&
          !target.startsWith('packages/contracts/')) ||
        (file.startsWith('packages/core/') && target.startsWith('apps/'))
      )
        throw new Error('模块依赖方向错误：' + file + ' → ' + target);
      targets.push(target);
    }
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
  console.log(`模块依赖检查通过：${files.length} 个源码文件，无代码循环依赖。`);
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename))
  checkModuleBoundaries();
