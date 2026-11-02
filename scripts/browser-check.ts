import { spawn } from 'node:child_process';
import { join } from 'node:path';
const child = spawn(process.execPath, ['--import', 'tsx', join(import.meta.dirname, 'foundation-check.ts'), '--production', '--audit-repairs', ...process.argv.slice(2)], { cwd: join(import.meta.dirname, '..'), windowsHide: true, env: process.env, stdio: 'inherit' });
child.once('error', (error) => { console.error(error); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
