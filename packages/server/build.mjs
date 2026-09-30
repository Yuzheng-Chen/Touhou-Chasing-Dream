import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  sourcemap: true,
  // Optional native accelerators for ws; not installed.
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    // Let bundled CommonJS deps (express) call require() inside an ESM bundle.
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
console.log('server built → dist/index.js');
