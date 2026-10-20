import type { Track } from './model.ts';
import type { SongMetadata } from './metadata.ts';
export async function loadAlbumMetadata(
  track: Track,
  cache: () => Promise<SongMetadata | undefined>,
  read: () => Promise<{ info: SongMetadata; warning?: string }>,
): Promise<{ info: SongMetadata; warning?: string }> {
  const saved = await cache().catch(() => undefined);
  if (
    saved?.version === 3 &&
    saved.size === track.size &&
    saved.modified === track.modified
  )
    return { info: saved };
  return read();
}
