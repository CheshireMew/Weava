import { join, resolve, relative } from 'node:path';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { WeavaError, VERSION, API_VERSION } from '@weava/contracts';

import { walk, atomicJson } from '../../runtime-common/src/files.ts';
import { digest, uuid, now } from '../../runtime-common/src/identity.ts';
import { SCHEMA_VERSION } from './schema-version.ts';
import { freezeProgramDependencies } from './program-dependencies.ts';

import { verifyProgram, type ProgramManifest } from '../../runtime-common/src/program-manifest.ts';
export { verifyProgram, type ProgramManifest } from '../../runtime-common/src/program-manifest.ts';
export function writeProgramManifest(output: string, dependencies: string) {
  const root = resolve(output),
    files = ['admin', 'web', 'runtime']
      .flatMap((folder) => walk(join(root, folder)))
      .map((file) => ({
        path: relative(root, file).replaceAll('\\', '/'),
        hash: digest(readFileSync(file)),
      }));
  const snapshot = freezeProgramDependencies(root, dependencies);
  const pkg = JSON.parse(readFileSync(join(resolve(dependencies), '..', 'package.json'), 'utf8'));
  const dependencyPackages = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter(
      (name) =>
        !String(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]).startsWith('workspace:'),
    )
    .map((name) => ({
      name,
      hash: digest(readFileSync(join(dependencies, name, 'package.json'))),
    }));
  const manifest: ProgramManifest = {
    version: 1,
    id: uuid(),
    framework: VERSION,
    apiVersion: API_VERSION,
    schemaVersion: SCHEMA_VERSION,
    nodeMajor: 24,
    platform: process.platform,
    upgradeProtocol: 2,
    createdAt: now(),
    dependencies: 'node_modules',
    dependencyPackages,
    dependencyFiles: snapshot.files,
    dependencyLinks: snapshot.links,
    files,
  };
  atomicJson(join(root, 'program.json'), manifest);
  return manifest;
}
export function selectedProgram(siteRoot: string) {
  const path = join(siteRoot, 'program.json');
  if (!existsSync(path)) return null;
  const pointer = JSON.parse(readFileSync(path, 'utf8'));
  const registered =
    pointer.version === 2
      ? JSON.parse(readFileSync(join(pointer.installationRoot, 'installation.json'), 'utf8'))
          .programs[pointer.programId]
      : null;
  if (pointer.version === 2 && !registered) throw new WeavaError('网站程序尚未在本机登记。');
  const program = verifyProgram(registered?.root ?? pointer.root);
  if (program.manifestHash !== pointer.manifestHash)
    throw new WeavaError('已选择的程序清单发生变化，请重新检查升级。');
  return { ...program, pointer };
}
export function defaultProgram(framework: string) {
  const file = join(framework, 'dist', 'current.json');
  if (!existsSync(file)) return null;
  const pointer = JSON.parse(readFileSync(file, 'utf8')),
    program = verifyProgram(pointer.root);
  if (program.manifestHash !== pointer.manifestHash)
    throw new WeavaError('默认构建版本的清单发生变化。');
  return program;
}
export function selectDefaultProgram(framework: string, output: string) {
  const checked = verifyProgram(output);
  mkdirSync(join(framework, 'dist'), { recursive: true });
  atomicJson(join(framework, 'dist', 'current.json'), {
    root: checked.root,
    manifestHash: checked.manifestHash,
  });
  return checked;
}
export {
  checkProgramUpgrade,
  applyProgramUpgrade,
  recoverProgramUpgrade,
  type UpgradePlan,
} from './legacy-program-upgrade.ts';
/** Read display metadata; startup and upgrades perform full program verification. */
export function programStatus(siteRoot: string) {
  const root = resolve(siteRoot),
    path = join(root, 'program.json');
  if (!existsSync(path)) return { selected: false, framework: VERSION };
  const pointer = JSON.parse(readFileSync(path, 'utf8'));
  if (pointer.version !== 2)
    return {
      selected: true,
      id: pointer.id,
      framework: pointer.framework,
      root: pointer.root,
      siteBuildId: pointer.siteBuildId,
      upgradePlanId: pointer.upgradePlanId,
    };
  const registered = JSON.parse(
    readFileSync(join(pointer.installationRoot, 'installation.json'), 'utf8'),
  ).programs[pointer.programId];
  if (!registered) throw new WeavaError('网站程序尚未在本机登记。');
  // The manifest is sufficient for status. Walking and hashing every dependency
  // here blocks the HTTP process on every admin page load and navigation.
  const source = readFileSync(join(registered.root, 'program.json'), 'utf8');
  if (digest(source) !== pointer.manifestHash)
    throw new WeavaError('已选择的程序清单发生变化，请重新检查升级。');
  const manifest = JSON.parse(source) as ProgramManifest;
  return {
    selected: true,
    id: manifest.id,
    framework: manifest.framework,
    root: resolve(registered.root),
    siteBuildId: pointer.siteBuildId,
    upgradePlanId: pointer.upgradePlanId,
  };
}
