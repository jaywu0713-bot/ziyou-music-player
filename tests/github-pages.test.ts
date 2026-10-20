import test from 'node:test';
import assert from 'node:assert/strict';
import { basePathFor, publicAssetPath } from '../lib/hosting.ts';
import { coverSearchAvailable } from '../lib/desktop/covers.ts';

void test('GitHub Pages assets include the project path while local hosting stays rooted', () => {
  const pages = new URL('https://jaywu0713-bot.github.io/ziyou-music-player/');
  const local = new URL('http://localhost:3000/');

  assert.equal(basePathFor(pages), '/ziyou-music-player');
  assert.equal(publicAssetPath('/decoder/manifest.json', '/ziyou-music-player/'), '/ziyou-music-player/decoder/manifest.json');
  assert.equal(publicAssetPath('/metadata/metadata-worker.js', '/'), '/metadata/metadata-worker.js');
  assert.equal(basePathFor(local), '');
});

void test('GitHub Pages marks the server-backed cover search unavailable', () => {
  assert.equal(coverSearchAvailable(new URL('https://jaywu0713-bot.github.io/ziyou-music-player/')), false);
  assert.equal(coverSearchAvailable(new URL('https://music.example.com/')), true);
});
