import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { API_VERSION } from '@weava/contracts';
import { digest } from '../packages/runtime-common/src/identity.ts';
import { atomicJson } from '../packages/runtime-common/src/files.ts';
import { inside } from '../packages/core/src/paths-io.ts';
import {
  inside as managedInside,
  within as managedWithin,
  verify as verifyManaged,
} from '../packages/manager/src/state.ts';
import { verifyProgram } from '../packages/core/src/programs.ts';
import { programEntries } from '../packages/runtime-common/src/program-manifest.ts';

it('shares lexical path containment, accepting dot-prefixed names while rejecting parent and sibling escapes', () => {
  const root = resolve('D:/Tools/cache/weava/tests/runtime-common-paths');
  for (const input of ['..notes/file.txt', './file.txt', 'nested/../file.txt', '']) {
    expect(inside(root, input)).toBe(managedInside(root, input));
    expect(inside(root, input)).toBe(resolve(root, input));
  }
  for (const input of ['../file.txt', join(root, '../sibling/file.txt'), 'E:/outside/file.txt']) {
    expect(() => inside(root, input)).toThrow();
    expect(() => managedInside(root, input)).toThrow();
    expect(managedWithin(root, resolve(root, input))).toBe(false);
  }
});
it('uses the same manifest, platform, file and dependency checks for legacy and managed programs', () => {
  const root = join('D:/Tools/cache/weava/tests', 'runtime-common-' + Date.now()),
    dependency = 'node_modules/test-runtime/index.js';
  mkdirSync(join(root, 'node_modules/test-runtime'), { recursive: true });
  writeFileSync(join(root, dependency), 'export const value=1;');
  const files = [...programEntries, 'runtime/manager.mjs'].map((path) => {
    mkdirSync(resolve(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), 'placeholder');
    return { path, hash: digest('placeholder') };
  });
  const manifest = {
    version: 1,
    id: 'common-test',
    apiVersion: API_VERSION,
    schemaVersion: 14,
    nodeMajor: Number(process.versions.node.split('.')[0]),
    platform: process.platform as string,
    files,
    dependencyFiles: [{ path: dependency, hash: digest('export const value=1;') }],
    dependencyLinks: [],
  };
  const save = (value = manifest) => atomicJson(join(root, 'program.json'), value);
  save();
  expect(verifyProgram(root)).toEqual(verifyManaged(root));
  expect(JSON.parse(readFileSync(join(root, 'program.json'), 'utf8'))).toEqual(manifest);
  save({ ...manifest, platform: 'incompatible-platform' });
  expect(() => verifyProgram(root)).toThrow(/平台/);
  expect(() => verifyManaged(root)).toThrow(/平台/);
  save({ ...manifest, files: files.filter((file) => file.path !== 'runtime/manager.mjs') });
  expect(() => verifyProgram(root)).not.toThrow();
  expect(() => verifyManaged(root)).toThrow(/manager.mjs/);
  save();
  writeFileSync(join(root, dependency), 'changed dependency');
  expect(() => verifyProgram(root)).toThrow(/依赖/);
  expect(() => verifyManaged(root)).toThrow(/依赖/);
});
