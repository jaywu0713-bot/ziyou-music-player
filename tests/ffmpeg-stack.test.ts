import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

void test('generated FFmpeg wrapper restores the WASM stack after every invocation', async () => {
  const { patchFFmpegCore } = await import('../scripts/patch-ffmpeg-core.mjs');
  const original = readFileSync(new URL('../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url), 'utf8');
  const patched = patchFFmpegCore(original);
  for (const name of ['exec', 'ffprobe']) {
    const body = patched.slice(patched.indexOf(`function ${name}(`), patched.indexOf(`function ${name === 'exec' ? 'ffprobe' : 'setLogger'}(`));
    const context = vm.createContext({pointer:100000, Module:{DEFAULT_ARGS:[], DEFAULT_ARGS_FFPROBE:[], ret:0}});
    vm.runInContext(`function stackSave(){return pointer} function stackRestore(p){pointer=p} function stringsToPtr(){return 1} Module._ffmpeg=Module._ffprobe=()=>{pointer-=224;throw new Error('Aborted')}; ${body}; for(let i=0;i<1000;i++) ${name}('input');`, context);
    assert.equal(context.pointer, 100000);
  }
});
