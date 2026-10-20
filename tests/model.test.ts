import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileRoot,
  nextEntryIndex,
  makeEntry,
  migrateLegacy,
  applySuccessfulRootScan,
  arrangeQueue,
  removeTemporaryTracks,
  queueOrder,
  emptyLibrary,
  reconcilePlayOrder,
  reconcileAddedPlayOrder,
} from '../lib/music/model.ts';
import type { Track } from '../lib/music/model.ts';
const original: Track = {
  id: 'song',
  name: '01.flac',
  format: 'FLAC',
  duration: 10,
  groups: ['relax'],
  rootId: 'a',
  path: 'album/01.flac',
  size: 5,
  modified: 1,
};

void test('changed source invalidates automatic identification but keeps manual correction', () => {
  const track: Track={...original,identification:{file:{artists:['Old']},automatic:{artists:['Guessed']},manual:{artists:['My edit']},status:'done'}};
  const [changed]=reconcileRoot([track],'a',[{path:'album/01.flac',name:'01.flac',size:6,modified:2}]);
  assert.deepEqual(changed.identification?.manual?.artists,['My edit']);
  assert.equal(changed.identification?.automatic,undefined);
  assert.equal(changed.identification?.status,undefined);
});
void test('relink commits only a completed scan and preserves removed paths', () => {
  const state = {
    version: 2 as const, tracks: [original], groups: [], queue: [], currentEntry: null,
    position: 0, volume: 70, mode: 0,
    roots: [{ id: 'a', name: 'Old', nativePath: '/old', excludedPaths: ['deleted.flac'] }],
  };
  const next = applySuccessfulRootScan(state, { id: 'a', name: 'New', nativePath: '/new' }, [
    { path: 'album/01.flac', name: '01.flac', size: 5, modified: 1 },
    { path: 'deleted.flac', name: 'deleted.flac', size: 5, modified: 1 },
  ], 123);
  assert.equal(state.roots[0].nativePath, '/old');
  assert.equal(next.roots[0].nativePath, '/new');
  assert.deepEqual(next.roots[0].excludedPaths, ['deleted.flac']);
  assert.equal(next.tracks.length, 1);
  assert.equal(next.tracks[0].id, 'song');
});
test('successful rescan preserves identity and classifications, missing then restored', () => {
  const missing = reconcileRoot([original], 'a', []);
  assert.equal(missing[0].missing, true);
  assert.deepEqual(missing[0].groups, ['relax']);
  const restored = reconcileRoot(missing, 'a', [
    { path: 'album/01.flac', name: '01.flac', size: 5, modified: 1 },
  ]);
  assert.equal(restored[0].id, 'song');
  assert.equal(restored[0].duration, 10);
  assert.equal(restored[0].missing, false);
});
test('same filename in another directory or root never merges', () => {
  const result = reconcileRoot([original], 'b', [
    { path: 'album/01.flac', name: '01.flac', size: 5, modified: 1 },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0], original);
  assert.deepEqual(result[1].groups, []);
});
test('changed content invalidates duration and keeps user grouping', () => {
  const result = reconcileRoot([original], 'a', [
    { path: 'album/01.flac', name: '01.flac', size: 10, modified: 2 },
  ]);
  assert.equal(result[0].duration, 0);
  assert.deepEqual(result[0].groups, ['relax']);
});
test('duplicate track queue entries advance by occurrence and stop at end', () => {
  const q = [makeEntry('a'), makeEntry('a'), makeEntry('b')];
  assert.notEqual(q[0].id, q[1].id);
  assert.equal(nextEntryIndex(q, q[0].id, 0), 1);
  assert.equal(nextEntryIndex(q, q[1].id, 0), 2);
  assert.equal(nextEntryIndex(q, q[2].id, 0, false, true), -1);
  assert.equal(nextEntryIndex(q, q[1].id, 2, false, true), 1);
  assert.notEqual(
    nextEntryIndex(q, q[1].id, 1, false, false, () => 0),
    1,
  );
});
test('legacy migration drops simulated music, keeps real classifications and duplicate queue', () => {
  const s = migrateLegacy(
    JSON.stringify({
      tracks: [
        { ...original, rootId: undefined, demo: false },
        { ...original, id: 'demo', demo: true },
      ],
      groups: [{ id: 'relax', name: '放松' }],
      queue: ['song', 'song', 'demo'],
      current: 'song',
      position: 4,
    }),
  );
  assert.equal(s.tracks.length, 1);
  assert.equal(s.queue.length, 2);
  assert.equal(s.position, 4);
  assert.equal(s.tracks[0].rootId, undefined);
  assert.equal(s.queue[0].id, s.currentEntry);
});

test('removing current music clears every queue occurrence and excludes it from future scans', async () => {
  const {removeTrack,emptyLibrary}=await import('../lib/music/model.ts');
  const entries=[makeEntry('song'),makeEntry('other'),makeEntry('song')];
  const state={...emptyLibrary(),tracks:[original,{...original,id:'other',path:'other.flac'}],roots:[{id:'a',name:'音乐'}],queue:entries,currentEntry:entries[2].id,position:4};
  const removed=removeTrack(state,'song');
  assert.equal(removed.tracks.length,1);assert.equal(removed.queue.length,1);assert.equal(removed.currentEntry,null);assert.equal(removed.position,0);
  assert.deepEqual(removed.roots[0].excludedPaths,['album/01.flac']);
  assert.equal(reconcileRoot(removed.tracks,'a',[{path:'album/01.flac',name:'01.flac',size:5,modified:1}],removed.roots[0].excludedPaths).length,1);
  assert.equal(state.tracks.length,2);
  const other=removeTrack({...state,currentEntry:entries[1].id},'song');assert.equal(other.currentEntry,entries[1].id);assert.equal(other.position,4);
});

test('random order is fixed by entry ID and survives duplicate songs', () => {
  const queue = [{id:'one',trackId:'a'},{id:'two',trackId:'a'},{id:'three',trackId:'b'}];
  const order = arrangeQueue(queue, 'one', 1, () => 0);
  assert.deepEqual(order, ['one','three','two']);
  assert.deepEqual(queueOrder(queue, order, 1).map(e => e.id), order);
  assert.equal(nextEntryIndex(queue, 'one', 1, false, true, Math.random, order), 2);
  assert.equal(nextEntryIndex(queue, 'three', 1, false, true, Math.random, order), 1);
});

test('temporary cleanup leaves bound and online music plus their queue entries', () => {
  const temporary={...original,id:'temp',rootId:undefined,path:undefined};
  const online={...temporary,id:'online',catalog:{provider:'jamendo' as const,providerId:'1',artist:'A',streamUrl:'https://example.com',licenseUrl:'https://example.com',pageUrl:'https://example.com'}};
  const queue=[{id:'a',trackId:'temp'},{id:'b',trackId:'song'},{id:'c',trackId:'online'}];
  const state={...emptyLibrary(),tracks:[temporary,original,online],queue,currentEntry:'a',position:9};
  const next=removeTemporaryTracks(state);
  assert.deepEqual(next.tracks.map(t=>t.id),['song','online']);
  assert.deepEqual(next.queue.map(e=>e.id),['b','c']);
  assert.equal(next.currentEntry,null);
  assert.equal(next.position,0);
});
test('next-up insertion becomes the next item in random order', () => {
  const q=[{id:'a',trackId:'A'},{id:'b',trackId:'B'},{id:'c',trackId:'C'},{id:'x',trackId:'X'}];
  assert.deepEqual(reconcilePlayOrder(q,['a','c','b'],'a','x'),['a','x','c','b']);
});
test('batch next-up keeps visible song order in random playback',()=>{
  const old=[{id:'a',trackId:'A'},{id:'b',trackId:'B'},{id:'c',trackId:'C'}];
  const queue=[...old,{id:'x',trackId:'X'},{id:'y',trackId:'Y'}];
  assert.deepEqual(reconcileAddedPlayOrder(queue,old,['a','c','b'],'a',true),['a','x','y','c','b']);
});
test('saved random order resumes from the first entry when current pointer is stale', () => {
  const q=[{id:'a',trackId:'A'},{id:'b',trackId:'B'}];
  assert.equal(nextEntryIndex(q,'missing',1,false,true,Math.random,['b','a']),1);
  assert.equal(nextEntryIndex(q,'missing',1,true,false,Math.random,['b','a']),0);
});
