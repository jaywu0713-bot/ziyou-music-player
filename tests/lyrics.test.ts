import test from 'node:test';
import assert from 'node:assert/strict';
import { activeLyricIndex, centeredLyricPaddingTop, centeredLyricScrollTop, decodeLyrics, lyricWindow, MAX_LYRICS_BYTES, parseLyrics } from '../lib/music/lyrics.ts';
import { candidateLyrics, rankLyrics, searchLyrics, type LyricsCandidate } from '../lib/music/lyrics-search.ts';

test('LRC parses multiple timestamps, translations, fractional seconds and metadata', () => {
  const parsed = parseLyrics('\uFEFF[ti:测试]\r\n[00:03.125]第三句\r\n[00:01.5][00:02.50]重复句\r\n[00:01.500]Translation\r\n[00:04.000]\r\n');
  assert.equal(parsed.kind, 'synced');
  assert.deepEqual(parsed.lines, [
    { timeMs: 1500, texts: ['重复句', 'Translation'] }, { timeMs: 2500, texts: ['重复句'] },
    { timeMs: 3125, texts: ['第三句'] }, { timeMs: 4000, texts: [''] },
  ]);
});

test('enhanced LRC keeps real word timestamps without inventing them for ordinary lines', () => {
  const parsed = parseLyrics('[00:01.000]<00:01.000>你<00:01.500>好\n[00:03.000]普通一句');
  assert.deepEqual(parsed.lines[0].texts, ['你好']);
  assert.deepEqual(parsed.lines[0].parts, [{timeMs:1000,text:'你'}, {timeMs:1500,text:'好'}]);
  assert.equal(parsed.lines[1].parts, undefined);
});

test('centered listening view exposes only the active lyric and its next line', () => {
  const lines=['one','two','three','four'];
  assert.deepEqual(lyricWindow(lines,-1),['one','two']);
  assert.deepEqual(lyricWindow(lines,1),['two','three']);
  assert.deepEqual(lyricWindow(lines,3),['four']);
  assert.deepEqual(lyricWindow([],0),[]);
});

test('active lyric scroll position centers the current line inside its own panel', () => {
  assert.equal(centeredLyricScrollTop(0, 180, 40, 200), 100);
  assert.equal(centeredLyricScrollTop(250, -100, 32, 400), 0);
  assert.equal(centeredLyricPaddingTop(10, 40, 200), 70);
  assert.equal(centeredLyricPaddingTop(120, 40, 200), 0);
});

test('highlight follows actual position including backwards seeks, exact boundaries and opposing offset conventions', () => {
  const parsed = parseLyrics('[offset:200]\n[00:01.000]一\n[00:02.000]二');
  assert.equal(activeLyricIndex(parsed, 799), -1);
  assert.equal(activeLyricIndex(parsed, 800), 0);
  assert.equal(activeLyricIndex(parsed, 1800), 1);
  assert.equal(activeLyricIndex(parsed, 1000), 0);
  assert.equal(activeLyricIndex(parsed, 1800, 500), 0);
  assert.equal(activeLyricIndex(parsed, 2300, 500), 1);
  assert.equal(activeLyricIndex(parsed, 300, -500), 0);
  assert.equal(activeLyricIndex(parsed, Number.NaN), -1);
  assert.equal(activeLyricIndex(parseLyrics('[offset:-200]\n[00:01]一'), 1199), -1);
});

test('plain, instrumental, invalid timestamps, literal markup and resource limits', () => {
  assert.equal(parseLyrics('[ar:歌手]\n纯文本歌词').kind, 'plain');
  assert.equal(parseLyrics('', true).kind, 'instrumental');
  assert.equal(parseLyrics('[00:60]错误\n[00:02]正常\n无标记').lines.length, 1);
  assert.ok(parseLyrics('[00:60]错误\n[00:02]正常\n无标记').warnings.length);
  assert.equal(parseLyrics('[00:01]<img src=x onerror=alert(1)>').lines[0].texts[0], '<img src=x onerror=alert(1)>');
  assert.throws(() => parseLyrics('a'.repeat(MAX_LYRICS_BYTES + 1)), /过大/);
  assert.throws(() => parseLyrics('[00:01]'.repeat(12_001) + '句子'), /时间标记过多/);
});

test('local encoding supports UTF-8 BOM, UTF-16 BOM and GBK fallback', () => {
  const utf8 = new TextEncoder().encode('\uFEFF[00:01]中文').buffer;
  assert.equal(decodeLyrics(utf8).text, '[00:01]中文');
  const gbk = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]).buffer;
  assert.deepEqual(decodeLyrics(gbk), { text: '中文', encoding: 'gb18030' });
  assert.deepEqual(decodeLyrics(Uint8Array.from([0xff, 0xfe, 0x2d, 0x4e]).buffer), { text: '中', encoding: 'utf-16le' });
  assert.throws(() => decodeLyrics(gbk, 'utf-8'));
});

test('online candidate ordering is explicit and preserves source metadata', () => {
  const sample: LyricsCandidate = { id: 1, title: '测试', artist: '歌手', album: '专辑', duration: 200, instrumental: false, syncedLyrics: '[00:01]一句', plainLyrics: '一句' };
  const items = [ { ...sample, id: 2, duration: 100, syncedLyrics: '' }, sample, { ...sample, id: 3, duration: 101 } ];
  assert.deepEqual(rankLyrics(items, 100).map((c) => c.id), [3, 1, 2]);
  assert.equal(items[0].id, 2);
  const saved = candidateLyrics(sample);
  assert.equal(saved.provider?.id, 1); assert.equal(saved.source, 'online'); assert.equal(saved.adjustmentMs, 0);
});

test('LRCLIB requests use only search text, identify client, validate responses and honor cancellation / rate limit', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://lrclib.net');
    assert.equal(url.searchParams.get('track_name'), '测试');
    assert.equal(url.searchParams.get('artist_name'), '歌手');
    assert.equal(init?.body, undefined);
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('X-User-Agent'), null);
    return Response.json([{ id: 1, trackName: '测试', artistName: '歌手', syncedLyrics: '[00:00]测试' }, { id: 'invalid' }]);
  });
  const run = () => searchLyrics(' 测试 ', '歌手', new AbortController().signal);
  assert.equal((await run()).length, 1);
  await assert.rejects(run, /频繁/); assert.equal(calls, 1);
  now += 1000;
  fetchMock.mock.mockImplementation(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
  await assert.rejects(run, /120 秒/);
  now += 60_000;
  await assert.rejects(run, /60 秒/);
  now += 61_000;
  fetchMock.mock.mockImplementation(async () => new Response('wrong'));
  await assert.rejects(run, /格式异常/);
  now += 1000;
  fetchMock.mock.mockImplementation(async () => new Response('', { headers: { 'Content-Length': '3000000' } }));
  await assert.rejects(run, /过大/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => searchLyrics('测试', '', controller.signal), { name: 'AbortError' });
});
