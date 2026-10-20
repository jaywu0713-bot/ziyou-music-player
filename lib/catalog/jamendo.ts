export type JamendoResult = {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  streamUrl: string;
  licenseUrl: string;
  pageUrl: string;
  coverUrl: string;
};

const API = 'https://api.jamendo.com/v3.0/tracks/';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SEARCH_LIMIT = 30;

function validClientId(value: string) {
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(id))
    throw new Error('请在个人偏好中填写有效的 Jamendo Client ID。');
  return id;
}

export function buildJamendoSearchUrl(
  clientId: string,
  query: string,
  offset = 0,
) {
  const search = query.trim();
  if (!search || search.length > 100)
    throw new Error('搜索内容需为 1 至 100 个字符。');
  const pageOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const url = new URL(API);
  url.search = new URLSearchParams({
    client_id: validClientId(clientId),
    format: 'json',
    search,
    limit: String(SEARCH_LIMIT),
    offset: String(pageOffset),
    include: 'licenses',
    audioformat: 'mp32',
  }).toString();
  return url.toString();
}

function safeJamendoUrl(value: unknown, base: string) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value.replace(/^http:\/\//i, 'https://'));
    if (
      url.protocol !== 'https:' ||
      (url.hostname !== base && !url.hostname.endsWith(`.${base}`))
    )
      return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function normalizeJamendoResults(payload: unknown): JamendoResult[] {
  if (!payload || typeof payload !== 'object')
    throw new Error('Jamendo 返回的数据格式异常。');
  const response = payload as {
    headers?: { status?: unknown; code?: unknown; error_message?: unknown };
    results?: unknown;
  };
  if (response.headers?.status !== 'success' || response.headers.code !== 0) {
    const message =
      typeof response.headers?.error_message === 'string'
        ? response.headers.error_message.slice(0, 180)
        : '';
    throw new Error(message || 'Jamendo 暂时无法完成搜索。');
  }
  if (!Array.isArray(response.results))
    throw new Error('Jamendo 返回的数据格式异常。');
  return response.results.flatMap((entry): JamendoResult[] => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const artist =
      typeof row.artist_name === 'string' ? row.artist_name.trim() : '';
    const duration = Number(row.duration);
    const streamUrl = safeJamendoUrl(row.audio, 'jamendo.com');
    const licenseUrl = safeJamendoUrl(
      row.license_ccurl,
      'creativecommons.org',
    );
    const pageUrl = safeJamendoUrl(row.shareurl, 'jamendo.com');
    if (
      !/^\d+$/.test(id) ||
      !name ||
      !artist ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !streamUrl ||
      !licenseUrl ||
      !pageUrl
    )
      return [];
    return [
      {
        id: `jamendo:${id}`,
        name,
        artist,
        album: typeof row.album_name === 'string' ? row.album_name.trim() : '',
        duration,
        streamUrl,
        licenseUrl,
        pageUrl,
        coverUrl: safeJamendoUrl(row.album_image || row.image, 'jamendo.com'),
      },
    ];
  });
}

export async function searchJamendo(
  clientId: string,
  query: string,
  signal?: AbortSignal,
): Promise<JamendoResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const response = await fetch(buildJamendoSearchUrl(clientId, query), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_RESPONSE_BYTES)
      throw new Error('Jamendo 返回内容过大，已停止读取。');
    if (!response.ok) throw new Error(`Jamendo 搜索失败（${response.status}）。`);
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES)
      throw new Error('Jamendo 返回内容过大，已停止读取。');
    signal?.throwIfAborted();
    return normalizeJamendoResults(JSON.parse(body));
  } catch (error) {
    if (signal?.aborted) throw new DOMException('搜索已取消。', 'AbortError');
    if (controller.signal.aborted)
      throw new Error('Jamendo 连接超时，请检查网络后重试。');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
