// build_vendor.mjs
// Bundles the Reactor browser SDK (an unbundled ESM package that bare-imports
// react/zustand/zod/sdp-transform/etc.) into a single browser-loadable module.
// The app's importmap points "@reactor-team/js-sdk" at the output of this build.
//
// Run:  node server/build_vendor.mjs

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [join(root, 'node_modules/@reactor-team/js-sdk/dist/index.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: join(root, 'vendor/reactor.bundle.mjs'),
  logLevel: 'info',
});

console.log('Bundled -> vendor/reactor.bundle.mjs');
