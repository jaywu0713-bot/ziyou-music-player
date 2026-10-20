import { MAX_LYRICS_BYTES, parseLyrics, type LyricsRecord } from './lyrics.ts';

export type LyricsCandidate = {
  id: number;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  instrumental: boolean;
  syncedLyrics: string;
  plainLyrics: string;
};

const ENDPOINT = 'https://lrclib.net/api/search';
let nextRequestAt = 0;

export function rankLyrics(candidates: LyricsCandidate[], duration: number) {
  return [...candidates].sort((a, b) => {
    const type = Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics);
    if (type) return type;
    if (!(duration > 0)) return 0;
    return (a.duration === null ? Infinity : Math.abs(a.duration - duration)) -
      (b.duration === null ? Infinity : Math.abs(b.duration - duration));
  });
}

export function candidateLyrics(candidate: LyricsCandidate): LyricsRecord {
  const rawText = candidate.syncedLyrics || candidate.plainLyrics;
  return {
    version: 1, source: 'online', label: `${candidate.title} · ${candidate.artist || '未知歌手'}`,
    rawText, parsed: parseLyrics(rawText, candidate.instrumental), adjustmentMs: 0, updatedAt: Date.now(),
    provider: { name: 'LRCLIB', id: candidate.id, title: candidate.title, artist: candidate.artist, album: candidate.album, duration: candidate.duration },
  };
}

export async function searchLyrics(title: string, artist: string, signal: AbortSignal): Promise<LyricsCandidate[]> {
  if (!title.trim()) throw new Error('请先填写歌曲名称。');
  if (title.length > 200 || artist.length > 200) throw new Error('歌曲名称和歌手请各控制在 200 字以内。');
  signal.throwIfAborted();
  if (Date.now() < nextRequestAt) throw new Error(`搜索过于频繁，请在 ${Math.ceil((nextRequestAt - Date.now()) / 1000)} 秒后重试。`);
  nextRequestAt = Date.now() + 500;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 12_000);
  try {
    const url = new URL(ENDPOINT);
    url.searchParams.set('track_name', title.trim());
    if (artist.trim()) url.searchParams.set('artist_name', artist.trim());
    const response = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? null : await fetch(url, {
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    });
    if (!response) {
      const { invoke } = await import('@tauri-apps/api/core');
      const data: unknown = await invoke('search_lyrics_native', { title: title.trim(), artist: artist.trim() })
        .catch((cause: unknown) => { throw new Error(typeof cause === 'string' ? cause : '歌词搜索失败，请稍后重试。'); });
      signal.throwIfAborted();
      return parseLyricsCandidates(data);
    }
    if (response.status === 429) {
      const retry = response.headers.get('Retry-After');
      const seconds = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) : NaN;
      const until = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retry || '');
      nextRequestAt = Math.max(Date.now() + 1000, Number.isFinite(until) ? until : Date.now() + 60_000);
      throw new Error(`歌词服务请求过多，请在 ${Math.ceil((nextRequestAt - Date.now()) / 1000)} 秒后重试。`);
    }
    if (!response.ok) throw new Error(`歌词服务暂不可用（${response.status}），可稍后重试或导入本地歌词。`);
    const maxResponse = 2 * 1024 * 1024;
    if (Number(response.headers.get('Content-Length')) > maxResponse) throw new Error('歌词搜索结果过大，请缩小搜索范围。');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('歌词服务返回了空内容。');
    let size = 0, body = '';
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxResponse) throw new Error('歌词搜索结果过大，请缩小搜索范围。');
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    signal.throwIfAborted();
    const data: unknown = JSON.parse(body);
    return parseLyricsCandidates(data);
  } catch (error) {
    if (timedOut) throw new Error('歌词搜索超时，请重试或导入本地 .lrc 文件。');
    if (signal.aborted) throw new DOMException('搜索已取消', 'AbortError');
    if (error instanceof TypeError) throw new Error('无法连接歌词服务，请检查网络或导入本地 .lrc 文件。');
    if (error instanceof SyntaxError) throw new Error('歌词服务返回格式异常，请稍后重试。');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    controller.abort();
  }
}

export function parseLyricsCandidates(data: unknown): LyricsCandidate[] {
    if (!Array.isArray(data)) throw new Error('歌词服务返回格式异常，请稍后重试。');
    return data.slice(0, 20).flatMap((row): LyricsCandidate[] => {
      if (!row || typeof row !== 'object' || !Number.isSafeInteger(row.id) || typeof row.trackName !== 'string') return [];
      const syncedLyrics = typeof row.syncedLyrics === 'string' ? row.syncedLyrics : '';
      const plainLyrics = typeof row.plainLyrics === 'string' ? row.plainLyrics : '';
      if ((!syncedLyrics && !plainLyrics && !row.instrumental) || syncedLyrics.length > MAX_LYRICS_BYTES || plainLyrics.length > MAX_LYRICS_BYTES) return [];
      return [{ id: row.id, title: row.trackName.slice(0, 500), artist: typeof row.artistName === 'string' ? row.artistName.slice(0, 500) : '', album: typeof row.albumName === 'string' ? row.albumName.slice(0, 500) : '', duration: typeof row.duration === 'number' && Number.isFinite(row.duration) && row.duration > 0 ? row.duration : null, instrumental: row.instrumental === true, syncedLyrics, plainLyrics }];
    });
}
