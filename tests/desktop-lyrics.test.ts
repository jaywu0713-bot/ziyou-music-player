import assert from 'node:assert/strict';
import test from 'node:test';
import { makeDesktopLyricsSnapshot, visibleLyricPosition, lyricLine } from '../lib/desktop/lyrics-state.ts';
import { parseLyrics } from '../lib/music/lyrics.ts';

void test('desktop lyrics alternate two slots by timed line, grouping translations', () => {
  const lyrics = parseLyrics('[00:01.00]First line\n[00:03.00]Second line\n[00:05.00]Third line');

  assert.deepEqual(makeDesktopLyricsSnapshot({
    trackName: 'Track title',
    lyrics: { version: 1, source: 'local', label: 'test', rawText: '', parsed: lyrics, adjustmentMs: 0, updatedAt: 0 },
    positionSeconds: 3.2,
    fontSize: 32,
    fontFamily: 'serif',
    accentColor: '#90bc68',
  }), {
    trackName: 'Track title',
    current: ['Third line'],
    next: ['Second line'],
    active: 1,
    fontSize: 32,
    fontFamily: 'serif',
    language: 'zh-CN',
    accentColor: '#90bc68',
  });
});
test('desktop lyric windows receive only their own line', () => {
  const snapshot={trackName:'A',current:['Now'],next:['Later'],active:0,fontSize:28,fontFamily:'sans' as const};
  assert.equal(lyricLine(snapshot,'current'),'Now');
  assert.equal(lyricLine(snapshot,'next'),'Later');
});
test('saved lyric position outside all screens falls back on screen', () => {
  const screens=[{position:{x:0,y:0},size:{width:1440,height:900}}];
  assert.deepEqual(visibleLyricPosition({x:9999,y:9999},{width:600,height:100},screens),{x:420,y:400});
  assert.deepEqual(visibleLyricPosition({x:200,y:100},{width:600,height:100},screens),{x:200,y:100});
  assert.deepEqual(visibleLyricPosition({x:1439,y:100},{width:600,height:100},screens),{x:420,y:400});
});

void test('desktop lyrics snapshot bounds preferences and leaves untimed lyrics blank', () => {
  const lyrics = parseLyrics('A plain line\nAnother line');

  assert.deepEqual(makeDesktopLyricsSnapshot({
    trackName: 'Untimed',
    lyrics: { version: 1, source: 'local', label: 'test', rawText: '', parsed: lyrics, adjustmentMs: 0, updatedAt: 0 },
    positionSeconds: 4,
    fontSize: 1000,
    fontFamily: 'sans',
  }), {
    trackName: 'Untimed',
    current: [],
    next: [],
    active: -1,
    fontSize: 48,
    fontFamily: 'sans',
    language: 'zh-CN',
  });
});

test('desktop lyrics place translation with original in one slot and recompute on seek', () => {
  const parsed = parseLyrics('[00:01]一\n[00:01]One\n[00:03]二\n[00:05]三\n[00:07]四');
  const lyrics = { version: 1 as const, source: 'local' as const, label: 'test', rawText: '', parsed, adjustmentMs: 0, updatedAt: 0 };
  const at = (positionSeconds: number) => makeDesktopLyricsSnapshot({trackName:'A',lyrics,positionSeconds,fontSize:28,fontFamily:'sans'});
  assert.deepEqual(at(0).current, ['一','One']);
  assert.deepEqual(at(0).next, ['二']);
  assert.deepEqual(at(3.2).current, ['三']);
  assert.deepEqual(at(3.2).next, ['二']);
  assert.equal(at(3.2).active, 1);
  assert.deepEqual(at(7.2).next, ['四']);
  assert.deepEqual(at(1.2).current, ['一','One']);
});
