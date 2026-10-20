import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { patchFFmpegCore } from './patch-ffmpeg-core.mjs';
const base = new URL('../', import.meta.url);
const dest = new URL('public/decoder/', base);
await mkdir(dest, {recursive: true});
const core = await readFile(new URL('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', base), 'utf8');
await writeFile(new URL('ffmpeg-core.js', dest), patchFFmpegCore(core));
// Each static asset stays below the hosting provider's per-file limit.
const wasm = await readFile(new URL('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', base));
const size = 8 * 1024 * 1024;
const parts = [];
for (let i = 0; i * size < wasm.length; i++) {
  const name = `ffmpeg-core.wasm.part${i}`;
  await writeFile(new URL(name, dest), wasm.subarray(i * size, (i + 1) * size)); parts.push(name);
}
await writeFile(new URL('manifest.json', dest), JSON.stringify({version: '0.12.10', bytes: wasm.length, parts}));
// Use the unbundled official module worker; avoids Vite optimizing it into a non-worker URL.
for (const name of ['worker.js', 'const.js', 'errors.js']) await copyFile(new URL(`node_modules/@ffmpeg/ffmpeg/dist/esm/${name}`, base), new URL(name, dest));
