import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlaybackFile } from '../lib/music/accompaniment.ts';

void test('instrumental selection plays cached audio while preserving track identity', async () => {
  const original = new File(['original'], 'song.flac');
  const cached = new File(['instrumental'], 'instrumental.flac');
  const track = {
    id: 'one',
    name: 'song.flac',
    format: 'FLAC',
    groups: [],
    duration: 8,
    playbackVersion: 'instrumental' as const,
  };
  assert.equal(
    await resolvePlaybackFile(
      track,
      async () => original,
      async () => cached,
      () => {},
    ),
    cached,
  );
  assert.equal(track.name, 'song.flac');
});
void test('a deleted cache falls back to original and informs the listener', async () => {
  const original = new File(['original'], 'song.flac');
  const messages: string[] = [];
  const track = {
    id: 'one',
    name: 'song.flac',
    format: 'FLAC',
    groups: [],
    duration: 8,
    playbackVersion: 'instrumental' as const,
  };
  assert.equal(
    await resolvePlaybackFile(
      track,
      async () => original,
      async () => null,
      (m) => messages.push(m),
    ),
    original,
  );
  assert.equal(messages.length, 1);
});
void test('original playback never loads instrumental cache', async () => {
  const original = new File(['original'], 'song.flac');
  const track = {
    id: 'one',
    name: 'song.flac',
    format: 'FLAC',
    groups: [],
    duration: 8,
  };
  assert.equal(
    await resolvePlaybackFile(
      track,
      async () => original,
      async () => {
        throw Error('unexpected cache access');
      },
      () => {},
    ),
    original,
  );
});

void test('fallback reports the actual original version before returning audio', async () => {
  const original = new File(['original'], 'song.flac');
  const track = {
    id: 'one',
    name: 'song.flac',
    format: 'FLAC',
    groups: [],
    duration: 8,
    playbackVersion: 'instrumental' as const,
  };
  let fallback = false;
  assert.equal(
    await resolvePlaybackFile(
      track,
      async () => {
        assert.equal(fallback, true);
        return original;
      },
      async () => null,
      () => {},
      () => {
        fallback = true;
      },
    ),
    original,
  );
});
