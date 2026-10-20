import { invoke } from '@tauri-apps/api/core';
import type { Track } from '../music/model';
import { resolveDesktopFile } from './folders';

export type VocalEntry = {
  trackId: string;
  key: string;
  name: string;
  sourceSize: number;
  sourceModified: number;
  bytes: number;
};
export type VocalStatus = {
  entries: VocalEntry[];
  job: { id: string; trackId: string; stage: string; progress: number } | null;
  modelReady: boolean;
  modelBytes: number;
  cacheBytes: number;
  cachePath: string;
  modelPath: string;
};
export async function cachedVocalFile(track: Track) {
  const path = await invoke<string | null>('vocal_cached', {
    trackId: track.id,
    size: track.size || 0,
    modified: track.modified || 0,
  });
  if (!path) return null;
  const separator = path.lastIndexOf('/');
  return resolveDesktopFile(
    { path: path.slice(0, separator), name: '伴奏缓存' },
    path.slice(separator + 1),
  );
}
