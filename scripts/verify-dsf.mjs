import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
globalThis.self={location:{href:'file:///ffmpeg-core.js'}};
const createCore=require('@ffmpeg/core');
const binary=await readFile(require.resolve('@ffmpeg/core/wasm'));
const core=await createCore({wasmBinary:binary});const logs=[];core.setLogger(({message})=>logs.push(message));core.setProgress(()=>{});
core.FS.writeFile('/tone.dsf',await readFile(new URL('../tests/fixtures/tone.dsf',import.meta.url)));
const exec=args=>{core.exec('-nostdin','-y',...args);const ret=core.ret;core.reset();if(ret)throw Error(logs.slice(-10).join('\n'));};
core.FS.writeFile('/tone.wav',await readFile(new URL('../tests/fixtures/tone.wav',import.meta.url)));
for(const [ext,codec] of [['flac','flac'],['mp3','libmp3lame']]){exec(['-v','error','-i','/tone.wav','-c:a',codec,'/tone.'+ext]);await writeFile(new URL('../tests/fixtures/tone.'+ext,import.meta.url),core.FS.readFile('/tone.'+ext));core.FS.unlink('/tone.'+ext);}
exec(['-v','error','-i','/tone.dsf','-ar','48000','-f','f32le','/full.pcm']);
const full=new Float32Array(core.FS.readFile('/full.pcm').slice().buffer);core.FS.unlink('/full.pcm');
const chunks=[];for(let offset=0;offset<7;offset+=2){const seek=Math.max(0,offset-.25);exec(['-v','error','-ss',String(seek),'-i','/tone.dsf','-ss',String(offset-seek),'-t',String(Math.min(2,7-offset)),'-ar','48000','-f','f32le','/chunk.pcm']);chunks.push(new Float32Array(core.FS.readFile('/chunk.pcm').slice().buffer));core.FS.unlink('/chunk.pcm');}
const combined=new Float32Array(chunks.reduce((n,c)=>n+c.length,0));let at=0;for(const c of chunks){combined.set(c,at);at+=c.length;}
let squared=0,peak=0,signal=0;for(let i=0;i<Math.min(full.length,combined.length);i++){const d=full[i]-combined[i];squared+=d*d;peak=Math.max(peak,Math.abs(d));signal+=full[i]*full[i];}
const initialHeap=core.HEAPU8.length;for(let i=0;i<120;i++){exec(['-v','error','-ss','2','-i','/tone.dsf','-t','2','-ar','48000','-f','f32le','/loop.pcm']);core.FS.unlink('/loop.pcm');}
const result={repeatedDecodeCalls:120,initialHeapBytes:initialHeap,source:'synthetic 440 Hz, DSD64 stereo, 7 seconds',reference:'same FFmpeg core, one continuous decode',referenceSamples:full.length,segmentedSamples:combined.length,rmsError:Math.sqrt(squared/full.length),maxError:peak,signalRMS:Math.sqrt(signal/full.length),coreHeapBytes:core.HEAPU8.length};
console.log(JSON.stringify(result,null,2));await writeFile(new URL('../tests/dsf-verification.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
if(Math.abs(full.length-combined.length)>4||result.rmsError>0.002)process.exitCode=1;
