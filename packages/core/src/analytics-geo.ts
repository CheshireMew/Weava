import { existsSync, readFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { gunzip } from 'node:zlib';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import { Reader, type CountryResponse } from 'maxmind';
const unzip=promisify(gunzip);

export class AnalyticsGeo {
  private reader?: Reader<CountryResponse>;
  private stamp = 0;
  private pending?: Promise<any>;
  private error = '';
  private checkedAt = '';
  private stopped = false;
  private controller?: AbortController;
  readonly file: string;
  constructor(root: string) {
    this.file = join(root, 'analytics', 'geoip-country.mmdb');
  }
  private load() {
    try {
      if (!existsSync(this.file)) return;
      const stamp = statSync(this.file).mtimeMs;
      if (stamp !== this.stamp) {
        this.reader = new Reader<CountryResponse>(readFileSync(this.file));
        this.stamp = stamp;
      }
    } catch (error: any) {
      this.error = error.message;
    }
  }
  status() {
    this.load();
    const metadata = this.reader?.metadata;
    return {
      available: !!this.reader,
      updating: !!this.pending,
      provider: 'DB-IP Lite',
      license: 'CC BY 4.0',
      attributionUrl: 'https://db-ip.com',
      updatedAt: this.stamp ? new Date(this.stamp).toISOString() : null,
      builtAt: metadata ? metadata.buildEpoch.toISOString() : null,
      checkedAt: this.checkedAt || null,
      error: this.error || null,
    };
  }
  country(ip = '') {
    this.load();
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    if (
      !isIP(ip) ||
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) ||
      /^(::1$|f[cd]|fe[89ab])/i.test(ip)
    )
      return '';
    try {
      return this.reader?.get(ip)?.country?.iso_code || '';
    } catch {
      return '';
    }
  }
  async update(force = false) {
    if (this.stopped) throw new Error('地区库服务已关闭。');
    if (this.pending) return this.pending;
    const state = this.status();
    const month = new Date().toISOString().slice(0, 7);
    if (!force && state.builtAt?.slice(0, 7) === month) return state;
    this.pending = (async () => {
      const controller = this.controller = new AbortController();
      this.checkedAt = new Date().toISOString();
      try {
        const response = await fetch(
          `https://download.db-ip.com/free/dbip-country-lite-${month}.mmdb.gz`,
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),headers:state.updatedAt?{'If-Modified-Since':new Date(state.updatedAt).toUTCString()}:{} },
        );
        if(response.status===304){this.error='';}
        else {
        if (!response.ok) throw new Error('地区库下载失败：HTTP ' + response.status);
        if (Number(response.headers.get('content-length')) > 30 * 1024 * 1024)
          throw new Error('地区库文件过大。');
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of response.body!) {
          size += chunk.length;
          if (size > 30 * 1024 * 1024) throw new Error('地区库文件过大。');
          chunks.push(chunk);
        }
        const bytes = await unzip(Buffer.concat(chunks), { maxOutputLength: 64 * 1024 * 1024 });
        const unchanged=existsSync(this.file)&&bytes.equals(await readFile(this.file));
        if(!unchanged){
        const candidate = new Reader<CountryResponse>(bytes);
        if (this.stopped) throw new Error('地区库服务已关闭。');
        if (!candidate.metadata.databaseType.toLowerCase().includes('country'))
          throw new Error('不是有效的国家地区数据库。');
        mkdirSync(join(this.file, '..'), { recursive: true });
        const staged = this.file + '.pending';
        await writeFile(staged, bytes);
        if (existsSync(this.file)) renameSync(this.file, this.file + '.previous');
        renameSync(staged, this.file);
        this.reader = candidate;
        this.stamp = statSync(this.file).mtimeMs;
        }
        this.error = '';
        }
      } catch (error: any) {
        this.error = error.message;
        throw error;
      } finally {
        this.controller = undefined;
        this.pending = undefined;
      }
      return this.status();
    })();
    return this.pending;
  }
  close() { this.stopped = true; this.controller?.abort(); }
}
