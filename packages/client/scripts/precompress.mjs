/**
 * After `vite build`: write a brotli (`.br`) and gzip (`.gz`) copy of every text file in dist/, so the server (and any proxy)
 * can send them without compressing per request. Pictures and fonts are already compressed and are skipped.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const TEXT = new Set(['.js', '.css', '.html', '.svg', '.json']);
let raw = 0;
let br = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (TEXT.has(extname(p))) {
      const data = readFileSync(p);
      const b = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
      writeFileSync(`${p}.br`, b);
      writeFileSync(`${p}.gz`, gzipSync(data, { level: 9 }));
      raw += data.length;
      br += b.length;
    }
  }
}
walk(dist);
console.log(`precompressed text assets: ${(raw / 1024).toFixed(0)} KB → ${(br / 1024).toFixed(0)} KB (brotli)`);
