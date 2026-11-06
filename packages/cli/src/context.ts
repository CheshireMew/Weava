import { createAdminClient } from '@weava/contracts/api-client';
import { resolve, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import type { Command } from 'commander';

export function createCliContext(
  program: Command,
  framework: string,
  bundledProgram: string | null,
) {
  function output(value: any) {
    console.log(JSON.stringify(value, null, program.opts().human ? 2 : 0));
  }
  function root() {
    return resolve(program.opts().site);
  }
  async function request(action: string, data?: any, format: 'json' | 'text' = 'json') {
    const config = existsSync(join(root(), 'site.json'))
      ? JSON.parse(readFileSync(join(root(), 'site.json'), 'utf8'))
      : {};
    const url = program.opts().url ?? `http://127.0.0.1:${config.port ?? 4322}`;
    const token = readFileSync(join(root(), 'cli-token'), 'utf8');
    const client = createAdminClient({
      baseUrl: url + '/api/admin/v1/',
      headers: { Authorization: 'Bearer ' + token },
      timeoutMs: 1800000,
    });
    // CLI command inputs are external JSON; runtime contracts validate them before
    // sending and check the response. Browser callers use the typed operation API.
    const result = await client.request(action, data);
    return result as any;
  }
  async function wait(job: any, enabled: boolean) {
    if (!enabled) return job;
    const end = Date.now() + 1800000;
    while (['queued', 'running'].includes(job.status)) {
      if (Date.now() > end) {
        process.exitCode = 2;
        return job;
      }
      await new Promise((r) => setTimeout(r, 500));
      job = await request('job/' + job.id);
    }
    if (job.status !== 'complete') process.exitCode = 1;
    return job;
  }
  return { program, framework, bundledProgram, root, output, request, wait };
}
export type CliContext = ReturnType<typeof createCliContext>;
