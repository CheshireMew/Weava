import { createHash, randomUUID } from 'node:crypto';

export const now = () => new Date().toISOString();
export const uuid = () => randomUUID();
export const digest = (value: unknown): string =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
