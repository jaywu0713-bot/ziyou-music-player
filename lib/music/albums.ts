import type { Track } from './model.ts';
import { effectiveCredits } from './identification.ts';
export type AlbumTrackInfo = {
  title?: string;
  discNumber?: number;
  trackNumber?: number;
  album?: string;
  artists?: string[];
  albumArtists?: string[];
};
export type Album = {
  id: string;
  name: string;
  artist: string;
  tracks: Track[];
};
const key = (s: string) => s.trim().normalize('NFC').toLocaleLowerCase();
export function albumCredits(track: Track, metadata?: AlbumTrackInfo) {
  const resolved = effectiveCredits(track);
  const saved = metadata;
  return {
    album:
      track.identification?.manual?.album ??
      track.identification?.automatic?.album ??
      track.identification?.file?.album ??
      saved?.album ??
      resolved.album,
    artists:
      track.identification?.manual?.artists ??
      track.identification?.automatic?.artists ??
      track.identification?.file?.artists ??
      saved?.artists ??
      resolved.artists,
    albumArtists:
      track.identification?.manual?.albumArtists ??
      track.identification?.automatic?.albumArtists ??
      track.identification?.file?.albumArtists ??
      saved?.albumArtists ??
      resolved.albumArtists,
  };
}
export function buildAlbums(
  tracks: Track[],
  metadata: Record<string, AlbumTrackInfo>,
): Album[] {
  const groups = new Map<string, Album>();
  for (const track of tracks) {
    if (track.catalog) continue;
    const credits = albumCredits(track, metadata[track.id]);
    const name = credits.album.trim();
    const artists = credits.albumArtists.length
      ? credits.albumArtists
      : credits.artists;
    const artist = artists.join('、');
    const id = name
      ? JSON.stringify([key(name), artists.map(key).sort()])
      : 'unknown';
    let album = groups.get(id);
    if (!album) {
      album = {
        id,
        name: name || '未知专辑',
        artist: name ? artist || '未知艺人' : '',
        tracks: [],
      };
      groups.set(id, album);
    }
    album.tracks.push(track);
  }
  for (const album of groups.values())
    album.tracks.sort((a, b) => {
      const x = metadata[a.id],
        y = metadata[b.id];
      const numberedX = !!x?.trackNumber,
        numberedY = !!y?.trackNumber;
      if (numberedX !== numberedY) return numberedX ? -1 : 1;
      return (
        (numberedX
          ? (x?.discNumber || 1) - (y?.discNumber || 1) ||
            (x?.trackNumber || 0) - (y?.trackNumber || 0)
          : 0) ||
        (x?.title || a.name).localeCompare(y?.title || b.name, 'zh-CN', {
          numeric: true,
        }) ||
        a.id.localeCompare(b.id)
      );
    });
  return [...groups.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'zh-CN') ||
      a.artist.localeCompare(b.artist, 'zh-CN'),
  );
}
