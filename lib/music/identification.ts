import type { LibraryState, Track } from './model.ts';
import { metadataGroups, type SmartGroup } from './smart-groups.ts';

export type Credits = { artists: string[]; album?: string; albumArtists?: string[] };
export type IdentificationCandidate = Credits & { id: string; title: string; duration?: number };
export type IdentificationRecord = {
  file?: Credits;
  automatic?: Credits;
  manual?: Partial<Credits>;
  candidates?: IdentificationCandidate[];
  status?: 'pending' | 'done' | 'needs-review' | 'failed';
  checkedAt?: number;
  algorithmVersion?: number;
};

export function effectiveCredits(track: Track): Required<Credits> {
  const identification = track.identification;
  return {
    artists: identification?.manual?.artists ?? identification?.automatic?.artists ?? identification?.file?.artists ?? [],
    album: identification?.manual?.album ?? identification?.automatic?.album ?? identification?.file?.album ?? '',
    albumArtists: identification?.manual?.albumArtists ?? identification?.automatic?.albumArtists ?? identification?.file?.albumArtists ?? [],
  };
}

export function manualCredits(artistsText: string, albumText: string, previous: Required<Credits>, albumArtistsText?: string): Required<Credits> {
  const artists = artistsText.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  const album = albumText.trim();
  return { artists, album, albumArtists: albumArtistsText === undefined ? [...previous.albumArtists] : albumArtistsText.split(/\r?\n/).map(name=>name.trim()).filter(Boolean) };
}

export function resetIdentification(track: Track): Track {
  return {...track,identification:{file:track.identification?.file,status:'done',algorithmVersion:3}};
}

const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
function fileClues(name: string) {
  const basename = name.replace(/\.[^.]+$/, '').replace(/^\s*\d{1,3}[.\s_-]+/, '').trim();
  const reversed=basename.match(/^(.+?)\s+[-–—]\s+(.+?)\s*\[([^\]]+)\]$/);
  if (reversed) return {artist:reversed[2].trim(),title:reversed[1].trim(),albumHint:reversed[3].trim()};
  const parts = basename.split(/\s*[-–—]\s*/);
  return parts.length === 2 && parts.every(Boolean) ? {artist:parts[0],title:parts[1],albumHint:''} : {artist:'', title:basename,albumHint:''};
}

export function recognitionQuery(name: string) {
  const {artist,title} = fileClues(name);
  return {title:title.slice(0,200),artist:artist.slice(0,200)};
}

export function chooseAutomaticMatch(name: string, duration: number, candidates: IdentificationCandidate[], knownArtist = ''): IdentificationCandidate | undefined {
  const clues = fileClues(name);
  const artist = knownArtist || clues.artist;
  if (!artist || !duration || !clues.title) return undefined;
  const matching = candidates.filter((candidate) =>
    normalized(candidate.title) === normalized(clues.title) &&
    candidate.artists.some((name) => normalized(name) === normalized(artist)) &&
    (!clues.albumHint || normalized(candidate.album || '') === normalized(clues.albumHint)) &&
    !!candidate.duration && Math.abs(candidate.duration - duration) <= 3,
  );
  const distinct = new Set(matching.map((candidate) => `${candidate.id.split(':')[0]}|${normalized(candidate.album || '')}`));
  return distinct.size === 1 ? matching[0] : undefined;
}

export function updateIdentifiedGroups(state: LibraryState, track: Track): LibraryState {
  const current = state.smartGroups || [];
  const credits = effectiveCredits(track);
  const fresh = (['artist', 'album'] as const).flatMap((kind) => metadataGroups(kind,[{id:track.id,...credits}]));
  const remaining = current.map((group) => group.kind === 'folder' ? group : {...group,trackIds:group.trackIds.filter((id) => id !== track.id)});
  const byId = new Map<string,SmartGroup>(remaining.filter((group) => group.kind === 'folder' || group.trackIds.length).map((group) => [group.id,group]));
  for (const group of fresh) {
    const old = byId.get(group.id);
    byId.set(group.id, old ? {...old,trackIds:[...old.trackIds,track.id]} : group);
  }
  return {...state,smartGroups:[...byId.values()]};
}
