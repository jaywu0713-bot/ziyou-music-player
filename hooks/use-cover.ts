'use client';
import { useEffect, useState } from 'react';
import type { Track } from '@/lib/music/model';
import { coverKey, embeddedCover, type CoverRecord } from '@/lib/music/covers';
import { coverStorage } from '@/lib/music/storage';
const immediate = (job: () => Promise<void>) => job();
export function useCover(
  track: Track | undefined,
  resolve: (track: Track) => Promise<File>,
  schedule: (job: () => Promise<void>) => Promise<void> = immediate,
) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    url: string;
    record?: CoverRecord;
  }>({ key: '', url: '' });
  const key = track ? coverKey(track) : '';
  useEffect(() => {
    let live = true;
    let url = '';
    async function read() {
      if (!live || !track) return;
      if (track.catalog) {
        setResult({ key, url: track.catalog.coverUrl || '' });
        return;
      }
      let custom: CoverRecord | undefined;
      try {
        custom = await coverStorage<CoverRecord>(coverKey(track, true), 'read');
      } catch {}
      let embedded: CoverRecord | undefined;
      try {
        embedded = custom
          ? await coverStorage<CoverRecord>(coverKey(track), 'read')
          : await embeddedCover(track, () => resolve(track));
      } catch {
        /* Inaccessible temporary files still retain custom covers. */
      }
      if (!live) return;
      const record = custom ? { ...embedded, ...custom } : embedded;
      if (record?.blob) url = URL.createObjectURL(record.blob);
      setResult({ key, url, record });
    }
    void schedule(read);
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [key, track, resolve, revision, schedule]);
  return {
    url: result.key === key ? result.url : '',
    record: result.key === key ? result.record : undefined,
    refresh: () => setRevision((v) => v + 1),
  };
}
