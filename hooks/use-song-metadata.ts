'use client';
import { useEffect, useState } from 'react';
import type { Track } from '@/lib/music/model';
import type { SongMetadata } from '@/lib/music/metadata';
import { readSongMetadata } from '@/lib/music/metadata-reader';
export function useSongMetadata(
  track: Track | undefined,
  resolve: (track: Track) => Promise<File>,
) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    info?: SongMetadata;
    error?: string;
    warning?: string;
  }>({ key: '' });
  const key = `${track?.id}:${track?.size}:${track?.modified}:${retry}:${track?.catalog ? 'catalog' : 'local'}`;
  useEffect(() => {
    let live = true;
    if (track && !track.catalog)
      void readSongMetadata(track, () => resolve(track), retry > 0).then(
        (data) => {
          if (live) setResult({ key, ...data });
        },
        (error) => {
          if (live)
            setResult({
              key,
              error:
                error instanceof Error ? error.message : '无法读取歌曲信息。',
            });
        },
      );
    return () => {
      live = false;
    };
  }, [key, track, resolve, retry]);
  return {
    ...(result.key === key ? result : {}),
    loading: !!track && result.key !== key,
    retry: () => setRetry((v) => v + 1),
  };
}
