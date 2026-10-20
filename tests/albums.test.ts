import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlbums, albumCredits } from '../lib/music/albums.ts';
import { songMetadata } from '../lib/music/metadata.ts';
import type { Track } from '../lib/music/model.ts';
import type { IAudioMetadata } from 'music-metadata';
const track = (
  id: string,
  album: string,
  artists: string[],
  albumArtists: string[] = [],
): Track => ({
  id,
  name: id,
  format: 'FLAC',
  duration: 1,
  groups: [],
  identification: { manual: { album, artists, albumArtists } },
});
void test('album artist keeps compilations together and separates namesakes', () => {
  const result = buildAlbums(
    [
      track('a', 'Hits', ['One'], ['Various']),
      track('b', 'Hits', ['Two'], ['Various']),
      track('c', 'Hits', ['Other'], ['Other']),
    ],
    {},
  );
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.find((a) => a.artist === 'Various')?.tracks.map((t) => t.id),
    ['a', 'b'],
  );
});
void test('disc and track order precede missing numbers, with stable title fallback', () => {
  const ts = ['z', 'b', 'a', 'c'].map((id) => track(id, 'Record', ['Singer']));
  const albums = buildAlbums(ts, {
    z: { discNumber: 2, trackNumber: 1 },
    b: { discNumber: 1, trackNumber: 2 },
    a: { discNumber: 1, trackNumber: 1 },
    c: {},
  });
  assert.deepEqual(
    albums[0].tracks.map((t) => t.id),
    ['a', 'b', 'z', 'c'],
  );
});
void test('unknown albums remain accessible and removed tracks disappear', () => {
  const a = track('a', '', []);
  assert.equal(buildAlbums([a], {})[0].name, '未知专辑');
  assert.equal(buildAlbums([], {}).length, 0);
});
void test('metadata retains positive integer disc and track numbers', () => {
  const info = songMetadata(
    {
      common: { track: { no: 3, of: 9 }, disk: { no: 2, of: 2 } },
      format: {},
      native: {},
    } as IAudioMetadata,
    { size: 1, lastModified: 0 },
  );
  assert.equal(info.trackNumber, 3);
  assert.equal(info.discNumber, 2);
});

void test('album song credits display automatic artist results and respect manual clearing', () => {
  const t = track('x', 'Record', []);
  t.identification = {
    automatic: { artists: ['Recognized'], album: 'Record' },
  };
  assert.deepEqual(albumCredits(t, { artists: [] }).artists, ['Recognized']);
  t.identification.manual = { artists: [] };
  assert.deepEqual(albumCredits(t, { artists: ['File'] }).artists, []);
});
