/**
 * One command to play several seats on this computer:
 *
 *   npm run local                 # build if needed, start the server, open the multi-seat console
 *   npm run local -- --seats 6    # number of seats (3–8)
 *   npm run local -- --port 3100 --no-open
 *
 * The console (/local) puts every seat in one window, each with its own identity and private hand.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const seats = Math.min(8, Math.max(3, Number(opt('seats', 4))));
const port = Number(opt('port', 3000));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const built = existsSync(resolve(root, 'packages/server/dist/index.js')) && existsSync(resolve(root, 'packages/client/dist/index.html'));
if (!built || argv.includes('--rebuild')) {
  console.log('Building (first run or --rebuild)…');
  const r = spawnSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const server = spawn(process.execPath, ['packages/server/dist/index.js'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PORT: String(port), NODE_ENV: 'production' },
});
server.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => server.kill());

const url = `http://localhost:${port}/local?n=${seats}`;
setTimeout(() => {
  console.log(`\n  本地多座位:  ${url}\n  (Ctrl+C 停止服务器)\n`);
  if (argv.includes('--no-open')) return;
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
}, 1200);
