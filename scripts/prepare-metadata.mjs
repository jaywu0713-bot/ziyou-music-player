import { build } from 'esbuild';
await build({
  entryPoints: ['lib/music/metadata.worker.ts'],
  outfile: 'public/metadata/metadata-worker.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
});
