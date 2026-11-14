import { spawn } from 'node:child_process';
import { join } from 'node:path';

/** One process boundary for candidate-program checks and maintenance commands. */
export function programCommand(options: {
  root: string;
  node: string;
  entry: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  json?: 'document' | 'last-line';
  timeoutMessage: string;
  failureMessage: string;
  invalidMessage: string;
}): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      options.node,
      [join(options.root, 'runtime', options.entry), ...options.args],
      {
        cwd: options.root,
        windowsHide: true,
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '',
      stderr = '',
      failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error(options.timeoutMessage);
      child.kill();
    }, options.timeoutMs);
    child.stdout.on('data', (data) => {
      stdout += data;
      if (stdout.length > 1_000_000) {
        stdout = stdout.slice(-16000);
        failure ??= new Error('程序输出超过限制。');
        child.kill();
      }
    });
    child.stderr.on('data', (data) => {
      stderr = (stderr + data).slice(-16000);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    // Wait for termination before a caller starts recovery against the same files.
    child.once('close', (code) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (code !== 0)
        return reject(new Error(options.failureMessage + (stderr || stdout).slice(-6000)));
      try {
        resolve(
          JSON.parse(options.json === 'last-line' ? stdout.trim().split('\n').at(-1)! : stdout),
        );
      } catch {
        reject(new Error(options.invalidMessage + stdout.slice(-2000)));
      }
    });
  });
}
