import type { PersonalPreferences } from './preferences.ts';
import type { LyricsRecord } from './lyrics.ts';
import type { LyricsWindowPreferences } from './lyrics-window.ts';
import type { SmartGroup } from './smart-groups.ts';
import type { IdentificationRecord } from './identification.ts';

export type Track = {
  id: string;
  name: string;
  format: string;
  duration: number;
  groups: string[];
  rootId?: string;
  path?: string;
  key?: string;
  size?: number;
  modified?: number;
  missing?: boolean;
  playbackVersion?: 'original' | 'instrumental';
  lyrics?: LyricsRecord;
  identification?: IdentificationRecord;
  catalog?: {
    provider: 'jamendo';
    providerId: string;
    artist: string;
    album?: string;
    streamUrl: string;
    licenseUrl: string;
    pageUrl: string;
    coverUrl?: string;
  };
};
export type Group = { id: string; name: string };
export type DirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>;
  entries(): AsyncIterableIterator<
    [string, FileSystemFileHandle | DirectoryHandle]
  >;
};
export type Root = {
  id: string;
  name: string;
  handle?: DirectoryHandle;
  nativePath?: string;
  scannedAt?: number;
  excludedPaths?: string[];
};
export type QueueEntry = { id: string; trackId: string };
export type LibraryState = {
  version: 2;
  tracks: Track[];
  groups: Group[];
  smartGroups?: SmartGroup[];
  acoustIdClientKey?: string;
  roots: Root[];
  queue: QueueEntry[];
  playOrder?: string[];
  currentEntry: string | null;
  position: number;
  volume: number;
  mode: number;
  personalPreferences?: PersonalPreferences;
  lyricsWindowPreferences?: LyricsWindowPreferences;
};
export const emptyLibrary = (): LibraryState => ({
  version: 2,
  tracks: [],
  groups: [],
  roots: [],
  queue: [],
  currentEntry: null,
  position: 0,
  volume: 70,
  mode: 0,
});
export const supportedExtension = (name: string) =>
  /\.(flac|dsf|dff|wav|mp3|m4a|aac|ogg|opus|aiff?|wma|ape|alac)$/i.test(name);
export const makeEntry = (trackId: string): QueueEntry => ({
  id: crypto.randomUUID(),
  trackId,
});
export function arrangeQueue(queue: QueueEntry[], current: string | null, mode: number, random = Math.random): string[] {
  const ids = queue.map((entry) => entry.id);
  if (mode !== 1) return ids;
  const remaining = ids.filter((id) => id !== current);
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }
  return current && ids.includes(current) ? [current, ...remaining] : remaining;
}
export function queueOrder(queue: QueueEntry[], order: string[] | undefined, mode: number): QueueEntry[] {
  if (mode !== 1 || !order) return queue;
  const byId = new Map(queue.map((entry) => [entry.id, entry]));
  const result: QueueEntry[] = [];
  for (const id of order) {
    const entry = byId.get(id);
    if (entry) { result.push(entry); byId.delete(id); }
  }
  return [...result, ...byId.values()];
}
export function reconcilePlayOrder(queue: QueueEntry[], order: string[] | undefined, current: string | null, nextId?: string): string[] {
  const ids = new Set(queue.map((entry) => entry.id));
  const result = [...new Set((order || []).filter((id) => ids.has(id)))];
  for (const entry of queue) if (!result.includes(entry.id)) result.push(entry.id);
  if (nextId && ids.has(nextId)) {
    const old = result.indexOf(nextId);
    if (old >= 0) result.splice(old, 1);
    const currentIndex = result.indexOf(current || '');
    result.splice(currentIndex + 1, 0, nextId);
  }
  return result;
}
export function reconcileAddedPlayOrder(queue:QueueEntry[],oldQueue:QueueEntry[],order:string[]|undefined,current:string|null,nextUp:boolean):string[] {
  const oldIds=new Set(oldQueue.map(entry=>entry.id));
  const added=queue.filter(entry=>!oldIds.has(entry.id)).map(entry=>entry.id);
  return added.reduceRight((previous,id)=>reconcilePlayOrder(queue,previous,current,nextUp?id:undefined),reconcilePlayOrder(queue,order,current));
}
export type ScannedFile = {
  path: string;
  name: string;
  size: number;
  modified: number;
};
/** Only call after a COMPLETE successful scan. Missing permissions must never mark tracks missing. */
export function reconcileRoot(
  tracks: Track[],
  rootId: string,
  files: ScannedFile[],
  excludedPaths: string[] = [],
): Track[] {
  const found = new Map(
    files
      .filter((f) => !excludedPaths.includes(f.path))
      .map((f) => [f.path, f]),
  );
  const result = tracks.map((t) => {
    if (t.rootId !== rootId) return t;
    const file = found.get(t.path || '');
    if (!file) return { ...t, missing: true };
    found.delete(file.path);
    return {
      ...t,
      name: file.name,
      size: file.size,
      modified: file.modified,
      missing: false,
      identification: t.size === file.size && t.modified === file.modified
        ? t.identification
        : t.identification?.manual ? {manual:t.identification.manual} : undefined,
      duration:
        t.size === file.size && t.modified === file.modified ? t.duration : 0,
    };
  });
  for (const file of found.values())
    result.push({
      id: crypto.randomUUID(),
      rootId,
      path: file.path,
      name: file.name,
      size: file.size,
      modified: file.modified,
      format: file.name.split('.').pop()!.toUpperCase(),
      duration: 0,
      groups: [],
      missing: false,
    });
  return result;
}
export function applySuccessfulRootScan(
  state: LibraryState,
  selected: Root,
  files: ScannedFile[],
  scannedAt = Date.now(),
): LibraryState {
  const previous = state.roots.find((root) => root.id === selected.id);
  const root: Root = {
    ...previous,
    ...selected,
    handle: selected.handle,
    nativePath: selected.nativePath,
    excludedPaths: previous?.excludedPaths,
    scannedAt,
  };
  return {
    ...state,
    tracks: reconcileRoot(state.tracks, root.id, files, root.excludedPaths),
    roots: previous
      ? state.roots.map((item) => item.id === root.id ? root : item)
      : [...state.roots, root],
  };
}
export function nextEntryIndex(
  queue: QueueEntry[],
  current: string | null,
  mode: number,
  back = false,
  ended = false,
  random = Math.random,
  order?: string[],
): number {
  if (!queue.length) return -1;
  const i = queue.findIndex((e) => e.id === current);
  if (ended && mode === 2 && i >= 0) return i;
  if (mode === 1 && order?.length) {
    const ordered = queueOrder(queue, order, mode);
    const position = ordered.findIndex((entry) => entry.id === current);
    if (position < 0) return queue.findIndex((entry) => entry.id === (back ? ordered.at(-1) : ordered[0])?.id);
    if (ended && position === ordered.length - 1) return -1;
    const next = ordered[(position + (back ? -1 : 1) + ordered.length) % ordered.length];
    return queue.findIndex((entry) => entry.id === next.id);
  }
  if (mode === 1 && !back && queue.length > 1) {
    const offset = 1 + Math.floor(random() * (queue.length - 1));
    return (Math.max(i, 0) + offset) % queue.length;
  }
  if (ended && i === queue.length - 1) return -1;
  return (i + (back ? -1 : 1) + queue.length) % queue.length;
}
export function migrateLegacy(raw: string | null): LibraryState {
  const result = emptyLibrary();
  if (!raw) return result;
  try {
    const s = JSON.parse(raw);
    if (!Array.isArray(s.tracks) || !Array.isArray(s.groups)) return result;
    result.groups = s.groups.filter(
      (g: Group) => typeof g?.id === 'string' && typeof g.name === 'string',
    );
    result.tracks = s.tracks
      .filter(
        (t: Track & { demo?: boolean }) =>
          !t.demo && typeof t.id === 'string' && typeof t.name === 'string',
      )
      .map((t: Track) => ({
        id: t.id,
        name: t.name,
        format: t.format || t.name.split('.').pop()?.toUpperCase() || '',
        duration: Number.isFinite(t.duration) ? t.duration : 0,
        groups: Array.isArray(t.groups)
          ? t.groups.filter((id) => result.groups.some((g) => g.id === id))
          : [],
        key: t.key,
      }));
    result.queue = (Array.isArray(s.queue) ? s.queue : [])
      .filter((id: string) => result.tracks.some((t) => t.id === id))
      .map(makeEntry);
    result.currentEntry =
      result.queue.find((e) => e.trackId === s.current)?.id || null;
    result.position = Number.isFinite(s.position) ? Math.max(0, s.position) : 0;
    result.volume = Number.isFinite(s.volume)
      ? Math.min(100, Math.max(0, s.volume))
      : 70;
    result.mode = [0, 1, 2].includes(s.mode) ? s.mode : 0;
  } catch {
    /* Leave malformed legacy data untouched. */
  }
  return result;
}

export function removeTrack(state: LibraryState, id: string): LibraryState {
  const track = state.tracks.find((t) => t.id === id);
  if (!track) return state;
  const removesCurrent = state.queue.some(
    (e) => e.id === state.currentEntry && e.trackId === id,
  );
  return {
    ...state,
    tracks: state.tracks.filter((t) => t.id !== id),
    queue: state.queue.filter((e) => e.trackId !== id),
    playOrder: state.playOrder?.filter((entryId) => !state.queue.some((entry) => entry.id === entryId && entry.trackId === id)),
    currentEntry: removesCurrent ? null : state.currentEntry,
    position: removesCurrent ? 0 : state.position,
    roots: state.roots.map((r) =>
      r.id === track.rootId && track.path
        ? {
            ...r,
            excludedPaths: [
              ...new Set([...(r.excludedPaths || []), track.path]),
            ],
          }
        : r,
    ),
  };
}
export function removeTemporaryTracks(state: LibraryState): LibraryState {
  const ids = new Set(state.tracks.filter((track) => !track.rootId && !track.catalog).map((track) => track.id));
  if (!ids.size) return state;
  const removedEntries = new Set(state.queue.filter((entry) => ids.has(entry.trackId)).map((entry) => entry.id));
  const removesCurrent = state.currentEntry !== null && removedEntries.has(state.currentEntry);
  return {
    ...state,
    tracks: state.tracks.filter((track) => !ids.has(track.id)),
    queue: state.queue.filter((entry) => !ids.has(entry.trackId)),
    playOrder: state.playOrder?.filter((entryId) => !removedEntries.has(entryId)),
    currentEntry: removesCurrent ? null : state.currentEntry,
    position: removesCurrent ? 0 : state.position,
  };
}
