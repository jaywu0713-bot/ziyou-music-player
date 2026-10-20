import type { IAudioMetadata } from 'music-metadata';
import type { Track } from './model.ts';
import { coverStorage } from './storage.ts';
import { songMetadata, type SongMetadata } from './metadata.ts';
import { publicAssetPath } from '../hosting.ts';
const pending = new Map<string, Promise<IAudioMetadata>>();
export function parseMusicFile(
  file: File,
  id: string,
): Promise<IAudioMetadata> {
  const key = `${id}:${file.size}:${file.lastModified}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const job = new Promise<IAudioMetadata>((resolve, reject) => {
    const worker = new Worker(
      new URL(publicAssetPath('/metadata/metadata-worker.js'), window.location.origin),
      { type: 'module' },
    );
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('读取歌曲信息超时，请重试。'));
    }, 20000);
    const finish = () => {
      clearTimeout(timeout);
      worker.terminate();
    };
    worker.onmessage = ({ data }) => {
      finish();
      if (data.error) reject(new Error(data.error));
      else resolve(data.metadata);
    };
    worker.onerror = () => {
      finish();
      reject(new Error('歌曲信息读取失败，请重试。'));
    };
    worker.postMessage(file);
  });
  pending.set(key, job);
  // Briefly reuse the same result for the cover and details consumers, without retaining album art forever.
  void job.then(
    () =>
      setTimeout(() => {
        if (pending.get(key) === job) pending.delete(key);
      }, 2000),
    () => {
      if (pending.get(key) === job) pending.delete(key);
    },
  );
  return job;
}
export async function readSongMetadata(
  track: Track,
  resolve: () => Promise<File>,
  force = false,
): Promise<{ info: SongMetadata; warning?: string }> {
  const key = `metadata:${track.id}`;
  const saved = await coverStorage<SongMetadata>(key, 'read').catch(
    () => undefined,
  );
  let file: File;
  try {
    file = await resolve();
  } catch (error) {
    if (saved && (saved.version === 1 || saved.version === 2 || saved.version === 3))
      return {
        info: saved,
        warning: '显示上次保存的信息；当前无法访问原文件，尚未验证是否变化。',
      };
    throw error;
  }
  if (
    !force &&
    saved?.version === 3 &&
    saved.size === file.size &&
    saved.modified === file.lastModified
  )
    return { info: saved };
  const info = songMetadata(await parseMusicFile(file, track.id), file);
  try {
    await coverStorage(key, 'write', info);
  } catch {
    return { info, warning: '信息已读取，但未能保存到本地缓存。' };
  }
  return { info };
}
