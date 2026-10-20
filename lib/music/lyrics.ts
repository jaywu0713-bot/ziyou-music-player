import { Lrc } from 'lrc-kit';

export type LyricLine = { timeMs: number; texts: string[]; parts?: {timeMs:number;text:string}[] };
export type ParsedLyrics = {
  kind: 'synced' | 'plain' | 'instrumental';
  lines: LyricLine[];
  plainText: string;
  /** LRC offset: a positive value advances the lyrics. */
  offsetMs: number;
  warnings: string[];
};
export type LyricsRecord = {
  version: 1;
  source: 'local' | 'online';
  label: string;
  rawText: string;
  parsed: ParsedLyrics;
  /** User adjustment: positive delays, negative advances. */
  adjustmentMs: number;
  updatedAt: number;
  provider?: { name: 'LRCLIB'; id: number; title: string; artist: string; album: string; duration: number | null };
};
export const MAX_LYRICS_BYTES = 512 * 1024;

export function parseLyrics(raw: string, instrumental = false): ParsedLyrics {
  if (raw.length > MAX_LYRICS_BYTES) throw new Error('歌词内容过大，请选择 512 KB 以内的文件。');
  const groups = new Map<number, LyricLine>();
  const plain: string[] = [];
  let offsetMs = 0, invalid = 0, untimed = 0, count = 0;
  for (const row of raw.replace(/^\uFEFF/, '').split(/\r\n?|\n/)) {
    const line = row.trim();
    const offset = line.match(/^\[offset:\s*([+-]?\d+)\s*\]$/i);
    if (offset) {
      const value = Number(offset[1]);
      if (Number.isSafeInteger(value) && Math.abs(value) <= 86_400_000) offsetMs = value;
      else invalid++;
      continue;
    }
    if (/^\[[a-z]+:.*\]$/i.test(line)) continue;
    const timed = line.match(/^((?:\[\d{1,6}:\d{2}(?:\.\d{1,3})?\]\s*)+)(.*)$/);
    if (!timed) {
      if (line) { plain.push(line); untimed++; }
      if (/^\[\d/.test(line)) invalid++;
      continue;
    }
    const enhanced = /(?:<|\[)\d{1,6}:\d{2}(?:\.\d{1,3})?(?:>|\])/.test(timed[2])
      ? Lrc.parse(`${timed[1].match(/\[\d{1,6}:\d{2}(?:\.\d{1,3})?\]/)?.[0] || ''}${timed[2]}`, { enhanced: true }).lyrics[0]
      : undefined;
    const parts = enhanced?.wordTimestamps?.map((part) => ({timeMs:Math.round(part.timestamp*1000),text:part.content}));
    const text = (enhanced?.content || timed[2]).trim();
    if (text) plain.push(text);
    for (const stamp of timed[1].matchAll(/\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]/g)) {
      if (Number(stamp[2]) >= 60) { invalid++; continue; }
      if (++count > 12_000) throw new Error('歌词时间标记过多，请精简后再导入。');
      const timeMs = (Number(stamp[1]) * 60 + Number(stamp[2])) * 1000 + Number((stamp[3] || '').padEnd(3, '0'));
      const group = groups.get(timeMs) || {timeMs,texts:[]};
      if (!group.texts.includes(text)) group.texts.push(text);
      if (parts?.length && !group.parts) group.parts = parts;
      groups.set(timeMs, group);
    }
  }
  const warnings: string[] = [];
  if (invalid) warnings.push('部分时间标记无效，已忽略；请核对预览。');
  if (groups.size && untimed) warnings.push('部分行没有时间标记，不参与同步显示。');
  return {
    kind: groups.size ? 'synced' : plain.length ? 'plain' : instrumental ? 'instrumental' : 'plain',
    lines: [...groups.values()].sort((a,b) => a.timeMs-b.timeMs),
    plainText: plain.join('\n'), offsetMs, warnings,
  };
}

export function activeLyricIndex(parsed: ParsedLyrics, playbackMs: number, adjustmentMs = 0): number {
  if (parsed.kind !== 'synced' || !Number.isFinite(playbackMs)) return -1;
  const time = playbackMs + parsed.offsetMs - adjustmentMs;
  let lo = 0, hi = parsed.lines.length - 1, found = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (parsed.lines[mid].timeMs <= time) { found = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return found;
}

/** Select the active line and its successor for the centered listening layout. */
export function lyricWindow<T>(lines: T[], activeIndex: number): T[] {
  if (!lines.length) return [];
  const start = Math.max(0, Math.min(lines.length, activeIndex < 0 ? 0 : activeIndex));
  return lines.slice(start, start + 2);
}

/** Scroll position that puts a lyric row's midpoint at the center of its own scroller. */
export function centeredLyricScrollTop(scrollTop: number, rowTop: number, rowHeight: number, viewportHeight: number): number {
  return Math.max(0, scrollTop + rowTop + rowHeight / 2 - viewportHeight / 2);
}

/** Extra leading space needed to center the first visible lyric when the pair has no scroll range. */
export function centeredLyricPaddingTop(rowTop: number, rowHeight: number, viewportHeight: number): number {
  return Math.max(0, viewportHeight / 2 - rowTop - rowHeight / 2);
}

export type LyricsEncoding = 'utf-8' | 'gb18030' | 'utf-16le' | 'utf-16be';
export function decodeLyrics(bytes: ArrayBuffer, encoding?: LyricsEncoding) {
  if (bytes.byteLength > MAX_LYRICS_BYTES) throw new Error('歌词文件过大，请选择 512 KB 以内的 .lrc 文件。');
  if (encoding) return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding };
  const prefix = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2));
  const detected = prefix[0] === 0xff && prefix[1] === 0xfe ? 'utf-16le' : prefix[0] === 0xfe && prefix[1] === 0xff ? 'utf-16be' : 'utf-8';
  try { return { text: new TextDecoder(detected, { fatal: true }).decode(bytes), encoding: detected as LyricsEncoding }; }
  catch { return { text: new TextDecoder('gb18030', { fatal: true }).decode(bytes), encoding: 'gb18030' as LyricsEncoding }; }
}

export function lyricsSearchTitle(filename: string) {
  return filename.replace(/\.[^.]+$/, '').replace(/^\d+[\s._-]+/, '').trim();
}
