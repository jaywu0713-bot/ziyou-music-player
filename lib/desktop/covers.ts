import type { CoverCandidate } from '../music/covers.ts';
import { basePathFor, publicAssetPath } from '../hosting.ts';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type CoverQuery = { title: string; artist: string; album: string };
type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export function coverImageUrl(desktop: boolean, id: string) {
  if (!ID.test(id)) throw new Error('封面编号无效。');
  return desktop
    ? `https://coverartarchive.org/release/${id}/front-500`
    : `${publicAssetPath('/api/covers')}?image=${id}`;
}

export function coverSearchAvailable(url: URL) {
  return basePathFor(url) === '';
}

export async function searchCoverCandidates(
  desktop: boolean,
  query: CoverQuery,
  fetchWeb: typeof fetch,
  invoke: Invoke,
  signal?: AbortSignal,
): Promise<CoverCandidate[]> {
  let data: unknown;
  if (desktop) {
    data = await invoke('search_covers', query);
    signal?.throwIfAborted();
  } else {
    if (typeof window !== 'undefined' && !coverSearchAvailable(new URL(window.location.href)))
      throw new Error('当前 GitHub Pages 版本不支持在线搜索封面。');
    const response = await fetchWeb(publicAssetPath('/api/covers') + '?' + new URLSearchParams(query), { signal });
    data = await response.json();
    if (!response.ok) {
      const error = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error : '搜索失败。';
      throw new Error(error);
    }
  }
  if (!Array.isArray(data)) throw new Error('搜索结果格式异常。');
  return data.filter((row): row is CoverCandidate =>
    !!row && typeof row.id === 'string' && ID.test(row.id) &&
    typeof row.title === 'string' && typeof row.artist === 'string',
  ).slice(0, 12);
}

export async function downloadCoverImage(
  desktop: boolean,
  id: string,
  fetchWeb: typeof fetch,
  invoke: Invoke,
  signal?: AbortSignal,
): Promise<Blob> {
  const url = coverImageUrl(desktop, id);
  if (!desktop) {
    const response = await fetchWeb(url, { signal });
    if (!response.ok) throw new Error('该封面暂不可用，请选择其他版本或上传图片。');
    return response.blob();
  }
  const result = await invoke('get_cover_image', { id });
  signal?.throwIfAborted();
  if (!result || typeof result !== 'object') throw new Error('封面数据无效。');
  const { bytes, mime } = result as { bytes?: unknown; mime?: unknown };
  if (!Array.isArray(bytes) || bytes.length > 10 * 1024 * 1024 ||
      !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(String(mime)))
    throw new Error('封面数据无效。');
  return new Blob([new Uint8Array(bytes)], { type: String(mime) });
}
