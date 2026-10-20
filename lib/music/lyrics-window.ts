import { activeLyricIndex, type LyricsRecord } from './lyrics.ts';

export type LyricsWindowPreferences = {
  fontSize: number;
  fontFamily: 'sans' | 'serif';
  lines: 1 | 2;
};

export function lyricsWindowPreferences(value?: Partial<LyricsWindowPreferences> | null): LyricsWindowPreferences {
  return {
    fontSize: typeof value?.fontSize === 'number' && Number.isFinite(value.fontSize)
      ? Math.min(48, Math.max(18, Math.round(value.fontSize))) : 28,
    fontFamily: value?.fontFamily === 'serif' ? 'serif' : 'sans',
    lines: value?.lines === 1 ? 1 : 2,
  };
}

/** Shares the same playback clock and offset rules as the main lyric panel. */
export function floatingLyricLines(record: LyricsRecord, positionMs: number) {
  const active = activeLyricIndex(record.parsed, positionMs, record.adjustmentMs);
  return {
    active,
    current: active < 0 ? ['♪'] : record.parsed.lines[active].texts,
    next: record.parsed.lines[active + 1]?.texts || [],
  };
}
