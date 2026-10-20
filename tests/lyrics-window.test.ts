import test from 'node:test';
import assert from 'node:assert/strict';
import { lyricsWindowPreferences, floatingLyricLines } from '../lib/music/lyrics-window.ts';
import { parseLyrics, type LyricsRecord } from '../lib/music/lyrics.ts';

test('floating lyrics use the same boundaries and calibration, with intro and ending states', () => {
  const rawText = '[offset:200]\n[00:01]第一句\n[00:01]Translation\n[00:02]第二句';
  const lyrics: LyricsRecord = { version: 1, source: 'local', label: '测试', rawText,
    parsed: parseLyrics(rawText), adjustmentMs: 500, updatedAt: 1 };
  assert.deepEqual(floatingLyricLines(lyrics, 1299), { active: -1, current: ['♪'], next: ['第一句', 'Translation'] });
  assert.deepEqual(floatingLyricLines(lyrics, 1300), { active: 0, current: ['第一句', 'Translation'], next: ['第二句'] });
  assert.deepEqual(floatingLyricLines(lyrics, 2300), { active: 1, current: ['第二句'], next: [] });
  assert.equal(floatingLyricLines(lyrics, 1400).active, 0);
});

test('old or invalid saved preferences use bounded compatible defaults', () => {
  assert.deepEqual(lyricsWindowPreferences(), { fontSize: 28, fontFamily: 'sans', lines: 2 });
  assert.equal(lyricsWindowPreferences({ fontSize: Infinity }).fontSize, 28);
  assert.equal(lyricsWindowPreferences({ fontSize: 100 }).fontSize, 48);
  assert.equal(lyricsWindowPreferences({ fontSize: -1 }).fontSize, 18);
  assert.deepEqual(lyricsWindowPreferences({ fontSize: 30.2, fontFamily: 'serif', lines: 1 }), { fontSize: 30, fontFamily: 'serif', lines: 1 });
});
