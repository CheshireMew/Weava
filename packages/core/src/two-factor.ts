import { createHmac, timingSafeEqual, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret() {
  const bytes = randomBytes(20); let bits = 0, buffer = 0, output = '';
  for (const byte of bytes) { buffer = (buffer << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; output += alphabet[(buffer >>> bits) & 31]; } }
  return output;
}
export function totpCode(secret: string, step = Math.floor(Date.now() / 30000)) {
  let bits = 0, buffer = 0; const bytes: number[] = [];
  for (const char of secret) { const value = alphabet.indexOf(char); if (value < 0) throw new Error('两步验证密钥无效。'); buffer = (buffer << 5) | value; bits += 5; if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); } }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const hash = createHmac('sha1', Buffer.from(bytes)).update(counter).digest(), offset = hash[19] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export function totpStep(secret: string, code: string, time = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(time / 30000);
  for (const candidate of [step, step - 1, step + 1])
    if (candidate >= 0 && timingSafeEqual(Buffer.from(totpCode(secret, candidate)), Buffer.from(code))) return candidate;
  return null;
}
function key(root: string, create = false) {
  const path = join(root, 'account.key');
  if (!existsSync(path) && create) writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 });
  const value = readFileSync(path); if (value.length !== 32) throw new Error('账户密钥文件无效，请从完整备份恢复。');
  return value;
}
export function sealSecret(root: string, secret: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(root, true), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(value => value.toString('base64')).join('.');
}
export function openSecret(root: string, encrypted: string) {
  const [iv, tag, data] = encrypted.split('.').map(value => Buffer.from(value, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(root), iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
