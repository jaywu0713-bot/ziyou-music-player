'use client';
import { useEffect, useRef, useState } from 'react';
import type { Track } from '@/lib/music/model';
import type { SongMetadata } from '@/lib/music/metadata';
import { coverStorage } from '@/lib/music/storage';
import { loadAlbumMetadata } from '@/lib/music/album-metadata';
import { readSongMetadata } from '@/lib/music/metadata-reader';
export function useAlbumMetadata(
  tracks: Track[],
  resolve: (track: Track) => Promise<File>,
  ready: boolean,
) {
  const [metadata, setMetadata] = useState<Record<string, SongMetadata>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(0);
  const [revision, setRevision] = useState(0);
  const latest = useRef(tracks);
  useEffect(() => {
    latest.current = tracks;
  }, [tracks]);
  const signatures = useRef(new Map<string, string>());
  const signature = tracks
    .filter((t) => !t.catalog)
    .map((t) => `${t.id}:${t.size}:${t.modified}:${t.missing}`)
    .join('|');
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const pending = latest.current.filter(
      (t) =>
        !t.catalog &&
        !t.missing &&
        signatures.current.get(t.id) !== `${t.size}:${t.modified}`,
    );
    void (async () => {
      setLoading(pending.length > 0);
      let failures = 0;
      for (const track of pending) {
        // Yield between files so import, playback and dragging remain responsive.
        await new Promise((r) => setTimeout(r, 30));
        if (!live) return;
        try {
          const { info, warning } = await loadAlbumMetadata(
            track,
            () => coverStorage<SongMetadata>(`metadata:${track.id}`, 'read'),
            () => readSongMetadata(track, () => resolve(track)),
          );
          if (!live) return;
          setMetadata((previous) => ({ ...previous, [track.id]: info }));
          if (!warning)
            signatures.current.set(track.id, `${track.size}:${track.modified}`);
          else failures++;
        } catch {
          if (!live) return;
          failures++;
        }
      }
      if (live) {
        setLoading(false);
        setFailed(failures);
      }
    })();
    return () => {
      live = false;
    };
  }, [signature, resolve, ready, revision]);
  return { metadata, loading, failed, retry: () => setRevision((v) => v + 1) };
}
