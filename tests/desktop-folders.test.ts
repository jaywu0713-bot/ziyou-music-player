import assert from 'node:assert/strict';
import test from 'node:test';
import { scopedMusicPath, readDesktopFileChunks } from '../lib/desktop/folders.ts';

void test('desktop music paths stay beneath the selected folder', () => {
  assert.equal(
    scopedMusicPath('/Users/me/Music', 'Jazz/track.flac'),
    '/Users/me/Music/Jazz/track.flac',
  );
  assert.equal(scopedMusicPath('/Users/me/Music', '../private.mp3'), null);
  assert.equal(scopedMusicPath('/Users/me/Music', '/etc/passwd'), null);
  assert.equal(scopedMusicPath('/Users/me/Music', 'Jazz//track.flac'), null);
  assert.equal(scopedMusicPath('/Users/me/Music', 'Jazz/./track.flac'), null);
  assert.equal(scopedMusicPath('/Users/me/Music', 'Jazz/track\u0000.flac'), null);
});

void test('desktop reads large files in bounded chunks and closes the handle', async () => {
  const sizes: number[] = [];
  let remaining = 2_500_000;
  let closed = false;
  const handle = {
    async read(buffer: Uint8Array) {
      sizes.push(buffer.byteLength);
      if (!remaining) return null;
      const count = Math.min(remaining, buffer.byteLength);
      buffer.fill(7, 0, count);
      remaining -= count;
      return count;
    },
    async close() { closed = true; },
  };
  const chunks = await readDesktopFileChunks(handle, 2_500_000);
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0), 2_500_000);
  assert.ok(sizes.every((size) => size <= 1024 * 1024));
  assert.equal(closed, true);
});
