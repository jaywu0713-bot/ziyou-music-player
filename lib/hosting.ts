declare const __APP_BASE_PATH__: string;

export function appBasePath() {
  return typeof __APP_BASE_PATH__ === 'string' ? __APP_BASE_PATH__ : '';
}

export function basePathFor(url: URL) {
  const firstSegment = url.pathname.split('/').filter(Boolean)[0];
  return url.hostname.endsWith('.github.io') && firstSegment === 'ziyou-music-player'
    ? '/ziyou-music-player'
    : '';
}

export function publicAssetPath(path: string, basePath = appBasePath()) {
  return `${basePath.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
