import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildJamendoSearchUrl,
  normalizeJamendoResults,
} from '../lib/catalog/jamendo.ts';

void test('Jamendo searches are bounded and request only stream and license fields', () => {
  const url = new URL(buildJamendoSearchUrl('my-client-id', '夜 雨', 30));
  assert.equal(url.origin, 'https://api.jamendo.com');
  assert.equal(url.pathname, '/v3.0/tracks/');
  assert.equal(url.searchParams.get('client_id'), 'my-client-id');
  assert.equal(url.searchParams.get('search'), '夜 雨');
  assert.equal(url.searchParams.get('limit'), '30');
  assert.equal(url.searchParams.get('offset'), '30');
  assert.equal(url.searchParams.get('include'), 'licenses');
  assert.equal(url.searchParams.get('audioformat'), 'mp32');
  assert.equal(url.searchParams.has('audiodownload'), false);
});

void test('Jamendo results keep attribution and license links, reject unsafe stream hosts', () => {
  const tracks = normalizeJamendoResults({
    headers: { status: 'success', code: 0 },
    results: [
      {
        id: '124',
        name: 'Quiet rain',
        artist_name: 'A. Singer',
        album_name: 'Night room',
        duration: 124.5,
        audio: 'https://prod-1.storage.jamendo.com/stream.mp3',
        audiodownload: 'https://prod-1.storage.jamendo.com/download.mp3',
        license_ccurl: 'http://creativecommons.org/licenses/by-nc/4.0/',
        shareurl: 'https://www.jamendo.com/track/124',
        album_image: 'https://usercontent.jamendo.com/album.jpg',
      },
      {
        id: '125', name: 'Bad', artist_name: 'Unknown', duration: 60,
        audio: 'https://malicious.example/audio.mp3',
        license_ccurl: 'http://creativecommons.org/licenses/by/4.0/',
        shareurl: 'https://www.jamendo.com/track/125',
      },
    ],
  });
  assert.deepEqual(tracks, [
    {
      id: 'jamendo:124',
      name: 'Quiet rain',
      artist: 'A. Singer',
      album: 'Night room',
      duration: 124.5,
      streamUrl: 'https://prod-1.storage.jamendo.com/stream.mp3',
      licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
      pageUrl: 'https://www.jamendo.com/track/124',
      coverUrl: 'https://usercontent.jamendo.com/album.jpg',
    },
  ]);
});
