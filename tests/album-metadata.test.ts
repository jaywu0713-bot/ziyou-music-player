import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAlbumMetadata } from '../lib/music/album-metadata.ts';
import type { Track } from '../lib/music/model.ts';
import type { SongMetadata } from '../lib/music/metadata.ts';
void test('warm album metadata cache does not resolve complete audio files', async () => {
  const track = { id: 'x', size: 10, modified: 2 } as Track;
  const cached = {
    version: 3,
    size: 10,
    modified: 2,
    artists: [],
    albumArtists: [],
  } as unknown as SongMetadata;
  let reads = 0;
  const value = await loadAlbumMetadata(
    track,
    async () => cached,
    async () => {
      reads++;
      throw Error('must not read audio');
    },
  );
  assert.equal(value.info, cached);
  assert.equal(reads, 0);
});
void test('changed source signature refreshes metadata', async () => {
  const track = { id: 'x', size: 11, modified: 3 } as Track;
  const cached = { version: 3, size: 10, modified: 2 } as SongMetadata;
  let reads = 0;
  await loadAlbumMetadata(
    track,
    async () => cached,
    async () => {
      reads++;
      return { info: { ...cached, size: 11, modified: 3 } };
    },
  );
  assert.equal(reads, 1);
});
