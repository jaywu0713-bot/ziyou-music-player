import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSongMetadata, parseMusicFile } from '../lib/music/metadata-reader.ts';
import type { Track } from '../lib/music/model.ts';
let starts = 0, stops = 0;
class WorkerMock {
  onmessage?: (event: {data: unknown}) => void;
  constructor() { starts++; }
  postMessage() { queueMicrotask(() => this.onmessage?.({data:{metadata:{common:{artists:['A','B']},format:{sampleRate:44100,duration:60,lossless:true},native:{}}}})); }
  terminate() {stops++;}
}
void test('details and artwork share parsing; cache validates file changes and flags inaccessible source', async t => {
  const previousWindow = globalThis.window;
  globalThis.window = {location:{origin:'http://localhost:3000'}} as Window & typeof globalThis;
  t.after(() => {globalThis.window = previousWindow;});
  const previous = globalThis.Worker;
  globalThis.Worker = WorkerMock as unknown as typeof Worker;
  t.after(() => {globalThis.Worker = previous;});
  const track: Track = {id:'cache-test',name:'song.flac',format:'FLAC',duration:0,groups:[]};
  const file = new File(['FLAC'], 'song.flac',{lastModified:1});
  await Promise.all([parseMusicFile(file,track.id),parseMusicFile(file,track.id)]);
  assert.equal(starts,1); assert.equal(stops,1);
  await readSongMetadata(track,async()=>file); await readSongMetadata(track,async()=>file);
  assert.equal(starts,1);
  const inaccessible = await readSongMetadata(track,async()=>{throw new Error('permission');});
  assert.match(inaccessible.warning!,/尚未验证/);
  await readSongMetadata(track,async()=>new File(['changed'],file.name,{lastModified:2})); assert.equal(starts,2);
});
