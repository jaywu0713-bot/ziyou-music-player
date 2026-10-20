// Fixed upstreams only. Search never receives a local music file or filesystem path.
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cache = new Map<string, { until: number; data: unknown }>();
let nextSearch = 0;
const agent = 'ZiYou/0.5 (https://jay-local-music-demo.jaywu0713.chatgpt.site)';
async function bounded(response: Response, max: number) {
  if (!response.ok) throw new Error(`上游服务返回 ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('服务返回空内容');
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error('返回内容过大');
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
function error(
  message: string,
  status: number,
  headers?: Record<string, string>,
) {
  return Response.json({ error: message }, { status, headers });
}
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
  try {
    if (params.has('image')) {
      const id = params.get('image')!;
      if (!ID.test(id)) return error('封面编号无效。', 400);
      let url = `https://coverartarchive.org/release/${id}/front-500`;
      let response: Response | undefined;
      for (let i = 0; i < 6; i++) {
        const parsed = new URL(url);
        if (
          parsed.protocol !== 'https:' ||
          parsed.username ||
          parsed.password ||
          parsed.port ||
          !(
            parsed.hostname === 'coverartarchive.org' ||
            parsed.hostname === 'archive.org' ||
            parsed.hostname.endsWith('.archive.org')
          )
        )
          throw new Error('封面地址不可用');
        response = await fetch(url, {
          signal,
          redirect: 'manual',
          headers: { 'User-Agent': agent },
        });
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('封面地址不可用');
        const next = new URL(location, url);
        if (next.protocol === 'http:') next.protocol = 'https:';
        url = next.href;
      }
      if (response?.status === 404) return error('该版本暂无封面。', 404);
      if (!response) throw new Error('封面不可用');
      const type = response.headers.get('content-type')?.split(';')[0] || '';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(type))
        throw new Error('封面格式不可用');
      const bytes = await bounded(response, 10 * 1024 * 1024);
      return new Response(bytes, {
        headers: {
          'Content-Type': type,
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    const title = (params.get('title') || '').trim(),
      artist = (params.get('artist') || '').trim(),
      album = (params.get('album') || '').trim();
    if (!title && !album) return error('请填写歌曲或专辑名称。', 400);
    if ([title, artist, album].some((v) => v.length > 200))
      return error('关键词请控制在 200 字以内。', 400);
    const key = JSON.stringify([title, artist, album]);
    const cached = cache.get(key);
    if (cached && cached.until > Date.now()) return Response.json(cached.data);
    if (Date.now() < nextSearch)
      return error('搜索较频繁，请稍后重试。', 429, {
        'Retry-After': String(
          Math.max(1, Math.ceil((nextSearch - Date.now()) / 1000)),
        ),
      });
    nextSearch = Date.now() + 1100;
    const quote = (v: string) => '"' + v.replace(/[\\"\n\r]/g, ' ') + '"';
    const kind = album ? 'release' : 'recording';
    const query = `${kind}:${quote(album || title)}${artist ? ` AND artist:${quote(artist)}` : ''}`;
    const url = new URL(`https://musicbrainz.org/ws/2/${kind}`);
    url.search = new URLSearchParams({
      query,
      fmt: 'json',
      limit: '12',
    }).toString();
    const response = await fetch(url, {
      signal,
      headers: { 'User-Agent': agent, Accept: 'application/json' },
    });
    if (response.status === 429 || response.status === 503) {
      nextSearch = Date.now() + 60_000;
      return error('封面服务繁忙，请一分钟后重试。', 429, {
        'Retry-After': '60',
      });
    }
    const data = JSON.parse(
      new TextDecoder().decode(await bounded(response, 1024 * 1024)),
    );
    const result = new Map<
      string,
      { id: string; title: string; artist: string }
    >();
    const rows = album ? data.releases : data.recordings;
    for (const row of Array.isArray(rows) ? rows : []) {
      const credits = row['artist-credit'];
      const artistName = Array.isArray(credits)
        ? credits
            .map((c) => c?.name || c?.artist?.name || '')
            .join(' / ')
            .slice(0, 300)
        : '';
      for (const release of album
        ? [row]
        : Array.isArray(row.releases)
          ? row.releases
          : []) {
        if (
          ID.test(release?.id) &&
          typeof release.title === 'string' &&
          result.size < 12
        )
          result.set(release.id, {
            id: release.id,
            title: release.title.slice(0, 300),
            artist: artistName,
          });
      }
    }
    const output = [...result.values()];
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { until: Date.now() + 300_000, data: output });
    return Response.json(output);
  } catch {
    return error('无法获取封面，请稍后重试或上传本地图片。', 502);
  }
}
