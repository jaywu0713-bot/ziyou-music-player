import { activeLyricIndex, type LyricsRecord } from '../music/lyrics.ts';

export type DesktopLyricsSnapshot = {
  trackName: string;
  current: string[];
  next: string[];
  active: number;
  fontSize: number;
  fontFamily: 'sans' | 'serif';
  language?: 'zh-CN' | 'en';
  accentColor?: string;
};
export type LyricPart = 'current' | 'next';
export function lyricLine(snapshot: DesktopLyricsSnapshot, part: LyricPart): string {
  return snapshot[part].join('\n');
}
export function visibleLyricPosition(saved: {x:number;y:number} | null, size: {width:number;height:number}, monitors: {position:{x:number;y:number};size:{width:number;height:number}}[]): {x:number;y:number} {
  if (saved && monitors.some((monitor) => {
    const horizontal = Math.min(saved.x + size.width, monitor.position.x + monitor.size.width) - Math.max(saved.x, monitor.position.x);
    const vertical = Math.min(saved.y + size.height, monitor.position.y + monitor.size.height) - Math.max(saved.y, monitor.position.y);
    return horizontal >= Math.min(64,size.width) && vertical >= Math.min(32,size.height);
  })) return saved;
  const first=monitors[0];
  if (!first) return saved || {x:0,y:0};
  return {x:Math.round(first.position.x+(first.size.width-size.width)/2),y:Math.round(first.position.y+(first.size.height-size.height)/2)};
}

export function makeDesktopLyricsSnapshot(input: {
  trackName: string;
  lyrics?: LyricsRecord;
  positionSeconds: number;
  fontSize: number;
  fontFamily: 'sans' | 'serif';
  language?: 'zh-CN' | 'en';
  accentColor?: string;
}): DesktopLyricsSnapshot {
  const { lyrics } = input;
  let lines: Pick<DesktopLyricsSnapshot, 'current' | 'next' | 'active'>;
  if (lyrics?.parsed.kind === 'synced') {
    const index = activeLyricIndex(lyrics.parsed, Math.max(0, input.positionSeconds) * 1000, lyrics.adjustmentMs);
    const currentIndex = index < 0 ? 0 : index % 2 === 0 ? index : index + 1;
    const nextIndex = index < 0 ? 1 : index % 2 === 1 ? index : index + 1;
    lines = {
      active: index < 0 ? -1 : index % 2,
      current: lyrics.parsed.lines[currentIndex]?.texts || [],
      next: lyrics.parsed.lines[nextIndex]?.texts || [],
    };
  } else {
    lines = { active: -1, current: [], next: [] };
  }

  return {
    trackName: input.trackName,
    ...lines,
    fontSize: Math.min(48, Math.max(18, Math.round(input.fontSize))),
    fontFamily: input.fontFamily === 'serif' ? 'serif' : 'sans',
    language: input.language === 'en' ? 'en' : 'zh-CN',
    ...(input.accentColor ? {accentColor:input.accentColor} : {}),
  };
}
