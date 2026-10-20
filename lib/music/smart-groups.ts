export type SmartGroupKind = 'folder' | 'artist' | 'album';
export type SmartGroup = { id: string; kind: SmartGroupKind; name: string; trackIds: string[] };

export function smartGroupIndex(groups: SmartGroup[], knownTrackIds: Set<string>): Map<string, SmartGroup[]> {
  const index = new Map<string, SmartGroup[]>();
  for (const group of groups) {
    if (group.kind === 'folder') continue;
    for (const trackId of group.trackIds) {
      if (!knownTrackIds.has(trackId)) continue;
      const matches = index.get(trackId) || [];
      matches.push(group);
      index.set(trackId, matches);
    }
  }
  return index;
}

const key = (value: string) => value.trim().normalize('NFC').toLocaleLowerCase();
const unknown = (kind: SmartGroupKind): SmartGroup => ({id:`${kind}:unknown`,kind,name:'信息未知',trackIds:[]});

export function folderGroups(roots: {id:string;name:string}[], tracks: {id:string;rootId?:string}[]): SmartGroup[] {
  return roots.map((root) => ({id:`folder:${root.id}`,kind:'folder' as const,name:root.name,trackIds:tracks.filter((track)=>track.rootId===root.id).map((track)=>track.id)}));
}

export function metadataGroups(kind: 'artist'|'album', rows: {id:string;artists:string[];album?:string;albumArtists:string[]}[]): SmartGroup[] {
  const groups = new Map<string,SmartGroup>();
  for (const row of rows) {
    const names = kind === 'artist' ? row.artists.filter(Boolean) : row.album?.trim() ? [row.album.trim()] : [];
    if (!names.length) {
      const id=`${kind}:unknown`;
      if (!groups.has(id)) groups.set(id,unknown(kind));
      groups.get(id)!.trackIds.push(row.id);
      continue;
    }
    for (const name of new Set(names)) {
      const albumArtist = row.albumArtists[0] || row.artists[0] || '';
      const id=kind==='artist' ? `artist:${JSON.stringify(key(name))}` : `album:${JSON.stringify([key(albumArtist),key(name)])}`;
      if (!groups.has(id)) groups.set(id,{id,kind,name:kind==='album' && albumArtist ? `${name} · ${albumArtist}` : name,trackIds:[]});
      groups.get(id)!.trackIds.push(row.id);
    }
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
}
