import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve, sep } from 'node:path';
const root = resolve(process.env.WEAVA_SITE, 'media') + sep;
const tracked = (path) => typeof path === 'string' && resolve(path).startsWith(root);
let syncBytes = 0, streamBytes = 0, streams = 0;
const read = fs.readFileSync, stream = fs.createReadStream;
fs.readFileSync = function(path, ...args) {
  const result = read.call(this, path, ...args);
  if (tracked(path)) syncBytes += Buffer.byteLength(result);
  return result;
};
fs.createReadStream = function(path, ...args) {
  const result = stream.call(this, path, ...args);
  if (tracked(path)) {
    streams++;
    result.on('data', (bytes) => { streamBytes += bytes.length; });
    result.once('close', () => { streams--; });
  }
  return result;
};
syncBuiltinESMExports();
process.on('message', (message) => {
  if (message?.type === 'media-io') process.send?.({ type: 'media-io', id: message.id, syncBytes, streamBytes, streams, memory: process.memoryUsage() });
});
