import test from 'node:test';
import assert from 'node:assert/strict';
import { coverImageUrl, searchCoverCandidates, downloadCoverImage } from '../lib/desktop/covers.ts';

void test('desktop cover search and download avoid the web-only API', async () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  const calls: string[] = [];
  const invoke = async (command: string): Promise<unknown> => {
    calls.push(command);
    return command === 'search_covers'
      ? [{ id, title: 'Album', artist: 'Artist' }]
      : { bytes: [255, 216, 255], mime: 'image/jpeg' };
  };
  const fetchWeb = async (): Promise<Response> => { throw new Error('web API called'); };
  const results = await searchCoverCandidates(true, { title: 'Song', artist: '', album: '' }, fetchWeb, invoke);
  const image = await downloadCoverImage(true, id, fetchWeb, invoke);
  assert.equal(results[0].id, id);
  assert.equal(image.type, 'image/jpeg');
  assert.equal(image.size, 3);
  assert.deepEqual(calls, ['search_covers', 'get_cover_image']);
  assert.equal(coverImageUrl(true, id), `https://coverartarchive.org/release/${id}/front-500`);
  assert.throws(() => coverImageUrl(true, '../bad'), /封面编号/);
});
