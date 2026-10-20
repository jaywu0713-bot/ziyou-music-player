import type { Track } from './model.ts';

export async function resolvePlaybackFile(
  track: Track,
  original: () => Promise<File>,
  cached: () => Promise<File | null>,
  report: (message: string) => void,
  onFallback: () => void = () => {},
): Promise<File> {
  if (track.playbackVersion !== 'instrumental' || track.catalog)
    return original();
  try {
    const file = await cached();
    if (file) return file;
    report('伴奏缓存已清除，已改为播放原曲。');
  } catch (error) {
    report(`伴奏暂不可用，已改为播放原曲。${String(error)}`);
  }
  onFallback();
  return original();
}
