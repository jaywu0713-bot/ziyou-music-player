import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readLibrary, writeLibrary } from '../lib/music/storage.ts';
import { emptyLibrary } from '../lib/music/model.ts';
import { parseLyrics } from '../lib/music/lyrics.ts';
test('IndexedDB restores complete library after separate open/close cycles', async () => {
  const state = emptyLibrary();
  state.groups = [{ id: 'group', name: '中文分类' }];
  state.tracks = [
    {
      id: 't',
      name: '01.flac',
      format: 'FLAC',
      duration: 10,
      groups: ['group'],
      rootId: 'root',
      path: '专辑/01.flac',
      lyrics: { version: 1, source: 'local', label: '01.lrc', rawText: '[00:01]测试', parsed: parseLyrics('[00:01]测试'), adjustmentMs: 500, updatedAt: 123 },
    },
  ];
  state.roots = [{ id: 'root', name: '音乐' }];
  state.position = 3;
  state.lyricsWindowPreferences = { fontSize: 32, fontFamily: 'serif', lines: 1 };
  await writeLibrary(state);
  const loaded = await readLibrary();
  assert.deepEqual(loaded, state);
  assert.notEqual(loaded, state);
  state.tracks[0].missing = true;
  await writeLibrary(state);
  assert.equal((await readLibrary())?.tracks[0].missing, true);
});
