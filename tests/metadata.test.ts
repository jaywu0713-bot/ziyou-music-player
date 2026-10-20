import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFile, type IAudioMetadata } from 'music-metadata';
import { songMetadata, bitDepth } from '../lib/music/metadata.ts';
void test('preserves names and explicit roles without splitting punctuation', () => {
  const raw = {
    common: {
      artists: ['Artist, Jr.', 'Orchestra'],
      composer: ['Composer'],
      conductor: ['Conductor'],
      'performer:instrument': ['Soloist (piano)'],
    },
    format: { lossless: true, bitsPerSample: 24 },
    native: { vorbis: [{ id: 'PERFORMER', value: 'Second soloist' }] },
  } as unknown as IAudioMetadata;
  const info = songMetadata(raw, { size: 100, lastModified: 2 });
  assert.deepEqual(info.artists, ['Artist, Jr.', 'Orchestra']);
  assert.deepEqual(info.performers, ['Soloist (piano)', 'Second soloist']);
  assert.equal(bitDepth(info), '24 bit');
});
void test('lossy depth is inapplicable and unknown values remain unknown', () => {
  const info = songMetadata(
    {
      common: {},
      format: { lossless: false, sampleRate: NaN },
      native: {},
    } as IAudioMetadata,
    { size: 1, lastModified: 0 },
  );
  assert.equal(bitDepth(info), '不适用（有损编码）');
  assert.equal(info.sampleRate, undefined);
  assert.deepEqual(info.performers, []);
});
void test('real FLAC WAV MP3 and DSF fixtures supply source specifications', async () => {
  for (const ext of ['flac', 'wav', 'mp3', 'dsf']) {
    const parsed = await parseFile(`tests/fixtures/tone.${ext}`, {
      duration: true,
    });
    const info = songMetadata(parsed, { size: 1, lastModified: 0 });
    assert.ok(info.duration! > 0);
    assert.ok(info.sampleRate! > 0);
    assert.equal(info.channels, 2);
    if (ext === 'dsf') {
      assert.equal(info.dsd, 'DSD64');
      assert.match(bitDepth(info), /DSD 1-bit/);
    }
    if (ext === 'mp3') assert.match(bitDepth(info), /不适用/);
  }
});
