'use client';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isDesktopApp } from '@/lib/music/files';
import { readSongMetadata } from '@/lib/music/metadata-reader';
import { chooseAutomaticMatch, effectiveCredits, manualCredits, recognitionQuery, resetIdentification, updateIdentifiedGroups, type Credits, type IdentificationCandidate } from '@/lib/music/identification';
import type { LibraryState, Track } from '@/lib/music/model';

type Library = {
  state: LibraryState;
  update: (fn: (state: LibraryState) => LibraryState) => void;
  resolveFile: (track: Track) => Promise<File>;
  ready: boolean;
  readOnly: boolean;
};

function validCandidates(value: unknown): IdentificationCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is IdentificationCandidate =>
    !!row && typeof row.id === 'string' && typeof row.title === 'string' &&
    Array.isArray(row.artists) && row.artists.every((artist: unknown) => typeof artist === 'string') &&
    typeof row.album === 'string' && Array.isArray(row.albumArtists) &&
    row.albumArtists.every((artist: unknown) => typeof artist === 'string') &&
    (row.duration === null || row.duration === undefined || (typeof row.duration === 'number' && Number.isFinite(row.duration))),
  ).slice(0,20);
}

export function useIdentification(library: Library) {
  const [paused,setPaused] = useState(false);
  const [progress,setProgress] = useState<{done:number;total:number}|null>(null);
  const [fingerprintBusy,setFingerprintBusy] = useState(false);
  const [generation,setGeneration] = useState(0);
  const running = useRef(false);
  const stop = useRef(false);
  const update = library.update;
  const resolveFile = library.resolveFile;
  useEffect(() => () => { stop.current=true; }, []);

  useEffect(() => {
    if (!isDesktopApp() || !library.ready || library.readOnly || paused || running.current) return;
    const pending = library.state.tracks.filter((track) => !track.catalog && !track.missing && (!track.identification?.status || track.identification.algorithmVersion !== 3));
    if (!pending.length) return;
    running.current=true;
    stop.current=false;
    void (async () => {
      await Promise.resolve();
      setProgress({done:0,total:pending.length});
      for (const [index,track] of pending.entries()) {
        if (stop.current) break;
        let identification: Track['identification'];
        let duration = 0;
        try {
          const {info,warning}=await readSongMetadata(track,()=>resolveFile(track));
          if (!warning && typeof info.duration === 'number' && Number.isFinite(info.duration) && info.duration > 0) duration=info.duration;
          const file: Credits={artists:info.artists,album:info.album,albumArtists:info.albumArtists || []};
          identification={file,status:warning ? 'failed' : 'done',checkedAt:Date.now(),algorithmVersion:3};
          if (!warning && (!info.artists.length || !info.album)) {
            const searchName=info.title || track.name;
            const query=recognitionQuery(searchName);
            const filename=recognitionQuery(track.name);
            const titleMatchesFilename=!!info.title && filename.title.normalize('NFKC').toLocaleLowerCase() === info.title.normalize('NFKC').toLocaleLowerCase();
            if (info.title && !query.artist) {
              if (titleMatchesFilename) query.artist=filename.artist;
            }
            if (query.title) {
              // MusicBrainz limits each client to one request per second.
              await new Promise((resolve)=>setTimeout(resolve,1200));
              if (stop.current) break;
              const candidates=validCandidates(await invoke('search_recordings',{...query,artist:info.artists[0] || query.artist}));
              const match=chooseAutomaticMatch(titleMatchesFilename ? track.name : searchName,info.duration || track.duration,candidates,info.artists[0] || query.artist);
              identification={...identification,candidates:match ? [] : candidates,
                automatic:match ? {
                  artists:info.artists.length ? info.artists : match.artists,
                  album:info.album || match.album || undefined,
                  albumArtists:info.albumArtists?.length ? info.albumArtists : match.albumArtists,
                } : undefined,
                status:match ? 'done' : candidates.length ? 'needs-review' : 'done'};
            }
          }
        } catch {
          identification={...identification,status:'failed',checkedAt:Date.now(),algorithmVersion:3};
        }
        if (stop.current) break;
        update((state) => {
          const current=state.tracks.find((item)=>item.id===track.id);
          if (!current) return state;
          const nextTrack={...current,duration:current.duration || duration,identification:{...current.identification,...identification,manual:current.identification?.manual}};
          return updateIdentifiedGroups({...state,tracks:state.tracks.map((item)=>item.id===track.id ? nextTrack : item)},nextTrack);
        });
        setProgress({done:index+1,total:pending.length});
      }
      running.current=false;
      setProgress(null);
      setGeneration((value)=>value+1);
    })();
  }, [library.state.tracks, library.ready, library.readOnly, paused, update, resolveFile, generation]);

  function togglePaused() { setPaused((value)=>!value); stop.current=true; }
  function retry(id: string) {
    update((state)=>({...state,tracks:state.tracks.map((track)=>track.id===id ? {...track,identification:{...track.identification,status:undefined}} : track)}));
    setPaused(false);
  }
  function saveManual(id: string, artists: string, album: string, albumArtists?: string) {
    update((state)=>{
      const current=state.tracks.find((track)=>track.id===id);
      if (!current) return state;
      const nextTrack:Track={...current,identification:{...current.identification,manual:manualCredits(artists,album,effectiveCredits(current),albumArtists),candidates:[],status:'done'}};
      return updateIdentifiedGroups({...state,tracks:state.tracks.map((track)=>track.id===id ? nextTrack : track)},nextTrack);
    });
  }
  function accept(id: string, candidate: IdentificationCandidate) {
    update((state)=>{
      const current=state.tracks.find((track)=>track.id===id);
      if (!current) return state;
      const nextTrack:Track={...current,identification:{...current.identification,manual:{artists:candidate.artists,album:candidate.album || '',albumArtists:candidate.albumArtists},candidates:[],status:'done'}};
      return updateIdentifiedGroups({...state,tracks:state.tracks.map((track)=>track.id===id ? nextTrack : track)},nextTrack);
    });
  }
  function clear(id: string) {
    update((state)=>{
      const current=state.tracks.find((track)=>track.id===id);
      if (!current) return state;
      const nextTrack=resetIdentification(current);
      return updateIdentifiedGroups({...state,tracks:state.tracks.map((track)=>track.id===id ? nextTrack : track)},nextTrack);
    });
  }
  async function fingerprint(track: Track, clientKey: string): Promise<number> {
    const root=library.state.roots.find((item)=>item.id===track.rootId);
    if (!root?.nativePath || !track.path) throw new Error('音频指纹识别仅支持已绑定的本地音乐文件夹。');
    if (!/^[A-Za-z0-9]{8,64}$/.test(clientKey)) throw new Error('请填写有效的 AcoustID Client API key。');
    setFingerprintBusy(true);
    try {
      const candidates=validCandidates(await invoke('fingerprint_lookup',{rootPath:root.nativePath,relativePath:track.path,clientKey}));
      update((state)=>({...state,acoustIdClientKey:clientKey,tracks:state.tracks.map((item)=>item.id===track.id ? {...item,identification:{...item.identification,candidates,status:candidates.length ? 'needs-review' as const : 'done' as const}} : item)}));
      return candidates.length;
    } finally { setFingerprintBusy(false); }
  }
  return {paused,progress,fingerprintBusy,fingerprint,togglePaused,retry,saveManual,accept,clear,effectiveCredits};
}
