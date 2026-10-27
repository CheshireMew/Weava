import { readFileSync, writeFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const rows = [];
for (const [name, version] of Object.entries({
  ...manifest.dependencies,
  ...manifest.devDependencies,
})) {
  if (String(version).startsWith('workspace:')) continue;
  const pkg = JSON.parse(readFileSync('node_modules/' + name + '/package.json', 'utf8'));
  rows.push({
    name,
    version: pkg.version,
    license: pkg.license,
    homepage: pkg.homepage ?? pkg.repository?.url,
    usage: manifest.dependencies[name] ? 'runtime' : 'development',
  });
}
writeFileSync(
  'docs/dependencies.json',
  JSON.stringify(
    { generatedAt: new Date().toISOString(), frameworkLicense: 'AGPL-3.0-only', packages: rows },
    null,
    2,
  ),
);
console.log(JSON.stringify({ packages: rows.length }));
