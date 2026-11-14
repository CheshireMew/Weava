import { expect, it } from 'vitest';
import { checkModuleSource, moduleDependencies } from '../scripts/module-dependencies.ts';
const paths = new Set([
  'apps/admin/src/Example.tsx',
  'packages/contracts/src/index.ts',
  'packages/core/src/index.ts',
  'packages/core/src/site.ts',
]);
it.each([
  "import type {Site} from '@weava/core';",
  "export type {Site} from '../../../packages/core/src/site.ts';",
  "type S=import('@weava/core').Site;",
  "async function load(){return import('@weava/core')}",
])('enforces browser boundaries for all dependency forms: %s', (source) => {
  expect(() => checkModuleSource('apps/admin/src/Example.tsx', source, paths)).toThrow(/依赖方向/);
});
it('parses Astro frontmatter, script imports and expression imports using the installed compiler', () => {
  const source =
    '---\nimport type {Site} from "./site.ts";\n---\n<script>import {Site} from "./site.ts";</script>{import("./site.ts")}';
  expect(moduleDependencies('example.astro', source)).toEqual(
    expect.arrayContaining([
      { specifier: './site.ts', kind: 'type' },
      { specifier: './site.ts', kind: 'static' },
      { specifier: './site.ts', kind: 'dynamic' },
    ]),
  );
  expect(() =>
    checkModuleSource(
      'apps/admin/src/Example.astro',
      '---\nimport type {Site} from "@weava/core";\n---\n<div/>',
      paths,
    ),
  ).toThrow(/依赖方向/);
});
it('keeps type and deferred edges subject to boundaries without treating them as eager initialization cycles', () => {
  expect(
    checkModuleSource(
      'packages/core/src/site.ts',
      'import type {Site} from "./index.ts"; const load=()=>import("./index.ts");',
      paths,
    ),
  ).toEqual([]);
  expect(
    checkModuleSource('apps/admin/src/Example.tsx', 'import {x} from "@weava/contracts";', paths),
  ).toEqual(['packages/contracts/src/index.ts']);
});
it.each([
  'site.store.raw.prepare("SELECT 1")',
  'site["store"].get("entry", id)',
  'const {store: database} = site;',
])('keeps application services behind domain repositories: %s', (source) => {
  expect(() => checkModuleSource('packages/core/src/admin-content.ts', source, paths)).toThrow(
    /领域仓库/,
  );
});
it('allows domain services and repository-owned SQL at their respective boundaries', () => {
  expect(() =>
    checkModuleSource('packages/core/src/admin-content.ts', 'site.entryStore.query(input)', paths),
  ).not.toThrow();
  expect(() =>
    checkModuleSource(
      'packages/core/src/entry-repository.ts',
      'this.store.raw.prepare("SELECT 1")',
      paths,
    ),
  ).not.toThrow();
});
