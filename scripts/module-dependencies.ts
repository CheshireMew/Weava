import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { validationToolsRoot } from './setup-validation.ts';
const require = createRequire(import.meta.url);
const ts = require(join(validationToolsRoot, 'node_modules/typescript/lib/typescript.js'));
const astro = createRequire(require.resolve('astro/package.json'))('@astrojs/compiler-rs');
interface Dependency {
  specifier: string;
  kind: 'static' | 'type' | 'dynamic';
}
export function moduleDependencies(file: string, source: string): Dependency[] {
  const dependencies: Dependency[] = [];
  const add = (specifier: unknown, kind: Dependency['kind']) => {
    if (typeof specifier === 'string') dependencies.push({ specifier, kind });
  };
  if (file.endsWith('.astro')) {
    const parsed = astro.parse(source);
    if (parsed.diagnostics?.some((item: any) => item.severity === 1))
      throw new Error('Astro 语法无效：' + file);
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (
        ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(
          node.type,
        ) &&
        node.source
      ) {
        const typeOnly =
          node.importKind === 'type' ||
          node.exportKind === 'type' ||
          (node.specifiers?.length &&
            node.specifiers.every(
              (item: any) => item.importKind === 'type' || item.exportKind === 'type',
            ));
        add(node.source.value, typeOnly ? 'type' : 'static');
      }
      if (node.type === 'ImportExpression') add(node.source?.value, 'dynamic');
      if (node.type === 'TSImportType')
        add(
          node.argument?.value ?? node.parameter?.value ?? node.parameter?.literal?.value,
          'type',
        );
      if (node.type === 'JSXOpeningElement' && node.name?.name === 'script')
        for (const attr of node.attributes ?? [])
          if (attr.name?.name === 'src') add(attr.value?.value, 'static');
      for (const value of Object.values(node))
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
    };
    visit(parsed.ast);
  } else {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = (node: any) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        const clause = node.importClause,
          names = clause?.namedBindings ?? node.exportClause;
        const typeOnly =
          node.isTypeOnly ||
          clause?.isTypeOnly ||
          (!clause?.name &&
            names?.elements?.length &&
            names.elements.every((entry: any) => entry.isTypeOnly));
        add(node.moduleSpecifier.text, typeOnly ? 'type' : 'static');
      }
      if (ts.isImportTypeNode(node)) add(node.argument?.literal?.text, 'type');
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      )
        add(node.arguments[0]?.text, 'dynamic');
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return dependencies;
}
const packageExports = new Map<string, Record<string, string>>();
const serviceBoundaries = new Set(
  [
    'admin-content',
    'admin-state',
    'authoring',
    'bulk-edit',
    'content-mutations',
    'content-validation',
    'entry-actions',
    'query',
    'public-page-selection',
    'revisions',
    'site-info',
    'media-display',
    'media-files',
    'media-crop',
    'media-optimization',
    'media-replacement',
    'image-variants',
    'job-runner',
    'task-runtime',
    'managed-jobs',
  ].map((name) => 'packages/core/src/' + name + '.ts'),
);
function checkServiceAccess(file: string, source: string) {
  if (!serviceBoundaries.has(file)) return;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = (node: any) => {
    const direct = ts.isPropertyAccessExpression(node) && node.name.text === 'store';
    const indexed = ts.isElementAccessExpression(node) && node.argumentExpression?.text === 'store';
    const binding = ts.isBindingElement(node) && (node.propertyName ?? node.name)?.text === 'store';
    if (direct || indexed || binding)
      throw new Error('业务服务应使用领域仓库，不直接访问通用存储：' + file);
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
function resolveDependency(file: string, specifier: string, paths: Set<string>) {
  let base: string | undefined;
  if (specifier.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(file), specifier));
  else if (specifier.startsWith('@weava/')) {
    const [name, ...subpath] = specifier.slice(7).split('/'),
      folder = 'packages/' + name;
    let exports = packageExports.get(folder);
    if (!exports && existsSync(folder + '/package.json')) {
      const value = JSON.parse(readFileSync(folder + '/package.json', 'utf8')).exports;
      exports = typeof value === 'string' ? { '.': value } : value;
      packageExports.set(folder, exports!);
    }
    const entry = exports?.[subpath.length ? './' + subpath.join('/') : '.'];
    if (typeof entry === 'string') base = posix.join(folder, entry);
  }
  return base
    ? [
        base,
        base + '.ts',
        base + '.tsx',
        base + '.astro',
        base + '/index.ts',
        base.replace(/\.js$/, '.ts'),
      ].find((path) => paths.has(path))
    : undefined;
}
export function checkModuleSource(file: string, source: string, paths: Set<string>) {
  checkServiceAccess(file, source);
  const dependencies = moduleDependencies(file, source),
    targets: string[] = [];
  for (const { specifier, kind } of dependencies) {
    const target = resolveDependency(file, specifier, paths);
    const browser = file.startsWith('apps/admin/') || file.startsWith('packages/contracts/');
    if (browser && specifier.startsWith('node:'))
      throw new Error('浏览器共享模块不能依赖 Node：' + file + ' → ' + specifier);
    if (!target) continue;
    if (serviceBoundaries.has(file) && target === 'packages/core/src/storage.ts')
      throw new Error('业务服务应通过领域仓库访问存储：' + file);
    if (
      (file.startsWith('packages/contracts/') && !target.startsWith('packages/contracts/')) ||
      (file.startsWith('packages/runtime-common/') &&
        !target.startsWith('packages/runtime-common/') &&
        !target.startsWith('packages/contracts/')) ||
      (file.startsWith('packages/core/') && target.startsWith('apps/')) ||
      (file.startsWith('apps/admin/') &&
        !target.startsWith('apps/admin/') &&
        !target.startsWith('packages/contracts/') &&
        !target.startsWith('packages/runtime-common/'))
    )
      throw new Error('模块依赖方向错误（' + kind + '）：' + file + ' → ' + target);
    if (kind === 'static') targets.push(target);
  }
  return targets;
}
