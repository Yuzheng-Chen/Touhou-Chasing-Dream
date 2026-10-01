import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** `--key value` / `--flag` command-line parsing. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    out[argv[i].slice(2)] = next === undefined || next.startsWith('--') ? 'true' : next;
  }
  return out;
}

async function freePort() {
  return new Promise((res) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

/**
 * Start the production server on a free port with test knobs:
 *  TCD_TEST_FAST=1            skip cosmetic pauses
 *  TCD_PROMPT_TIMEOUT=0       humans never time out
 *  TCD_OFFLINE_AUTO_MS=3000   a bot covers a player who is offline for 3 s
 */
export async function startServer(existingUrl, { realtime = false } = {}) {
  if (existingUrl) return { url: existingUrl, stop: () => {}, errors: () => '' };
  const port = await freePort();
  const proc = spawn(process.execPath, ['packages/server/dist/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'production', TCD_TEST_FAST: realtime ? '0' : '1', TCD_PROMPT_TIMEOUT: '0', TCD_OFFLINE_AUTO_MS: '3000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errOut = '';
  proc.stderr.on('data', (d) => { errOut += d; });
  proc.stdout.on('data', () => {});
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${url}/healthz`)).ok) return { url, stop: () => proc.kill(), errors: () => errOut };
    } catch { /* not up yet */ }
    await sleep(200);
  }
  proc.kill();
  throw new Error('server did not start (did you run `npm run build`?)\n' + errOut);
}
