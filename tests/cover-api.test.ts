import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/covers/route.ts';
const id = 'f268b8bc-2768-426b-901b-c7966e76de29';
void test('cover search uses fixed MusicBrainz API, deduplicates albums and caches results', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.hostname, 'musicbrainz.org');
    assert.equal(
      url.searchParams.get('query'),
      'recording:"Example" AND artist:"Artist"',
    );
    return Response.json({
      recordings: [
        {
          'artist-credit': [{ name: 'Artist' }],
          releases: [
            { id, title: 'Album' },
            { id, title: 'Album' },
          ],
        },
      ],
    });
  });
  const request = () =>
    new Request('http://localhost/api/covers?title=Example&artist=Artist');
  assert.deepEqual(await (await GET(request())).json(), [
    { id, title: 'Album', artist: 'Artist' },
  ]);
  await GET(request());
  assert.equal(calls, 1);
});
void test('image proxy rejects arbitrary IDs and redirects to unapproved hosts', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(null, {
      status: 302,
      headers: { Location: 'https://example.com/private' },
    });
  });
  assert.equal(
    (
      await GET(
        new Request('http://localhost/api/covers?image=https://example.com'),
      )
    ).status,
    400,
  );
  assert.equal(calls, 0);
  assert.equal(
    (await GET(new Request('http://localhost/api/covers?image=' + id))).status,
    502,
  );
  assert.equal(calls, 1);
});
void test('image proxy accepts only an image response and provides cacheable bytes', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'image/jpeg' },
      }),
  );
  const response = await GET(
    new Request('http://localhost/api/covers?image=' + id),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal((await response.arrayBuffer()).byteLength, 3);
});
