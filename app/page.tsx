'use client';
import {
  getLanguage,
  setLanguage,
  subscribeLanguage,
  message,
  number as localizedNumber,
} from '@/lib/i18n/core';
import { useTranslation } from '@/lib/i18n/react';
import { publicAssetPath } from '@/lib/hosting';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { flushSync } from 'react-dom';
import {
  AudioLines,
  ChartNoAxesColumnIncreasing,
  Settings2,
  Library,
  Folder,
  FolderPlus,
  Search,
  Plus,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  ListMusic,
  FileText,
  MoreHorizontal,
  Upload,
  ArrowUp,
  ArrowDown,
  Music2,
  Info,
  Repeat1,
  Shuffle,
  ListOrdered,
  ExternalLink,
  Palette,
  PanelTop,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import {
  Sidebar,
  SidebarProvider,
  SidebarContent,
  SidebarTrigger,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@/components/ui/sidebar';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

import { useMusicLibrary } from '@/hooks/use-music-library';
import { canBindDirectory, isDesktopApp } from '@/lib/music/files';
import {
  makeEntry,
  nextEntryIndex,
  arrangeQueue,
  queueOrder,
  reconcilePlayOrder,
  reconcileAddedPlayOrder,
  type Track,
  type Group,
  type QueueEntry,
} from '@/lib/music/model';
import { useVisualizationWindow } from '@/hooks/use-visualization-window';
import { useSongMetadata } from '@/hooks/use-song-metadata';
import { readSongMetadata } from '@/lib/music/metadata-reader';
import {
  folderGroups,
  metadataGroups,
  smartGroupIndex,
  type SmartGroup,
  type SmartGroupKind,
} from '@/lib/music/smart-groups';
import { SongDetails } from '@/components/song-details';
import { VocalPanel } from '@/components/vocal-panel';
import { useMiniPlayer } from '@/hooks/use-mini-player';
import { useVocals } from '@/hooks/use-vocals';
import { cachedVocalFile } from '@/lib/desktop/vocals';
import { resolvePlaybackFile } from '@/lib/music/accompaniment';
import { useCover } from '@/hooks/use-cover';
import { buildAlbums } from '@/lib/music/albums';
import { useLayoutPreferences } from '@/hooks/use-layout-preferences';
import { LayoutPreferencesControls } from '@/components/layout-preferences';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { FlowWorkspace } from '@/components/flow-workspace';
import { AlbumBrowser } from '@/components/album-browser';
import { useAlbumMetadata } from '@/hooks/use-album-metadata';
import { CoverPanel } from '@/components/cover-panel';
import { FocusListening } from '@/components/focus-listening';
import { PersonalPreferencesDialog } from '@/components/personal-preferences';
import { personalPreferences } from '@/lib/music/preferences';
import { resolveTheme } from '@/lib/music/theme';
import { MusicPlayer, idlePlayer } from '@/lib/music/player';
import { LyricsPanel } from '@/components/lyrics-panel';
import { LyricsWindow } from '@/components/lyrics-window';
import { useLyricsWindow } from '@/hooks/use-lyrics-window';
import { lyricsWindowPreferences } from '@/lib/music/lyrics-window';
import { isTauri } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { makeDesktopLyricsSnapshot } from '@/lib/desktop/lyrics-state';
import {
  DESKTOP_LYRICS_EVENT,
  DESKTOP_LYRICS_REQUEST_EVENT,
} from '@/lib/desktop/window';
import { useDesktopLyricsWindow } from '@/hooks/use-desktop-lyrics-window';
import { useIdentification } from '@/hooks/use-identification';
import { effectiveCredits } from '@/lib/music/identification';
import { searchJamendo, type JamendoResult } from '@/lib/catalog/jamendo';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

const libraryDialogModes = [
  'new',
  'rename',
  'assign',
  'import',
  'info',
  'folders',
  'relink',
  'identify',
];

const clock = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
function jamendoTrack(item: JamendoResult): Track {
  return {
    id: item.id,
    name: item.name,
    format: 'MP3',
    duration: item.duration,
    groups: [],
    catalog: {
      provider: 'jamendo',
      providerId: item.id.slice('jamendo:'.length),
      artist: item.artist,
      album: item.album || undefined,
      streamUrl: item.streamUrl,
      licenseUrl: item.licenseUrl,
      pageUrl: item.pageUrl,
      coverUrl: item.coverUrl || undefined,
    },
  };
}
export default function Home() {
  const tr = useTranslation();
  useEffect(() => {
    const sync = () => {
      document.documentElement.lang = getLanguage();
      document.title =
        getLanguage() === 'en' ? '自用 · Music player' : '自用音乐播放器';
    };
    sync();
    return subscribeLanguage(sync);
  }, []);
  const [view, setView] = useState('all'),
    [mainPage, setMainPage] = useState<'library' | 'focus'>('library'),
    [focusChooserOpen, setFocusChooserOpen] = useState(false),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [queueOpen, setQueueOpen] = useState(false),
    [lyricsOpen, setLyricsOpen] = useState(false),
    [modal, setModal] = useState(''),
    [name, setName] = useState(''),
    [targets, setTargets] = useState<string[]>([]),
    [notice, setNotice] = useState(''),
    [drag, setDrag] = useState(false),
    [relinkId, setRelinkId] = useState(''),
    [removeId, setRemoveId] = useState('');
  const [editId, setEditId] = useState('');
  const [organizeLyricsOpen, setOrganizeLyricsOpen] = useState(false);
  const [coverFromOrganize, setCoverFromOrganize] = useState(false);
  const [artistDraft, setArtistDraft] = useState('');
  const [albumDraft, setAlbumDraft] = useState('');
  const [albumArtistDraft, setAlbumArtistDraft] = useState('');
  const [acoustIdKeyDraft, setAcoustIdKeyDraft] = useState('');
  const [fingerprintMessage, setFingerprintMessage] = useState('');
  const [onlineResults, setOnlineResults] = useState<JamendoResult[]>([]);
  const [systemDark, setSystemDark] = useState(true);
  const [organizing, setOrganizing] = useState<{
    kind: SmartGroupKind;
    done: number;
    total: number;
  } | null>(null);
  const organizeAbort = useRef<AbortController | null>(null);
  const [onlineStatus, setOnlineStatus] = useState<
    'idle' | 'needs-client-id' | 'loading' | 'error' | 'empty' | 'ready'
  >('idle');
  const library = useMusicLibrary(setNotice);
  const identification = useIdentification(library);
  const floatingLyrics = useLyricsWindow();
  const desktopLyrics = useDesktopLyricsWindow();
  const { state, update, ready, readOnly, busy, storageError } = library;
  const { tracks, groups, queue, currentEntry, volume, mode } = state;
  const albumData = useAlbumMetadata(
    tracks,
    library.resolveFile,
    ready && mainPage === 'library' && view === 'albums',
  );
  const albumCount = useMemo(
    () => buildAlbums(tracks, albumData.metadata).length,
    [tracks, albumData.metadata],
  );
  const [albumCoverRevision, setAlbumCoverRevision] = useState(0);
  const vocals = useVocals(state.roots, library.resolveFile, setNotice);
  const resolveAudio = useCallback(
    (item: Track) =>
      isTauri()
        ? resolvePlaybackFile(
            item,
            () => library.resolveFile(item),
            async () => {
              if (!item.rootId) await library.resolveFile(item);
              return cachedVocalFile(item);
            },
            setNotice,
            () =>
              update((s) => ({
                ...s,
                tracks: s.tracks.map((t) =>
                  t.id === item.id ? { ...t, playbackVersion: 'original' } : t,
                ),
              })),
          )
        : library.resolveFile(item),
    [library.resolveFile, update],
  );
  function clearVocalSelection(id?: string) {
    update((s) => ({
      ...s,
      tracks: s.tracks.map((item) =>
        !id || item.id === id ? { ...item, playbackVersion: 'original' } : item,
      ),
    }));
  }
  const smartGroups = state.smartGroups || [];
  const editingTrack = state.tracks.find((item) => item.id === editId);
  const knownTrackIds = new Set(tracks.map((item) => item.id));
  const smartTags = isTauri()
    ? smartGroupIndex(smartGroups, knownTrackIds)
    : new Map<string, SmartGroup[]>();
  const orderedQueue = queueOrder(queue, state.playOrder, mode);
  const temporaryCount = tracks.filter(
    (item) => !item.rootId && !item.catalog,
  ).length;
  const layout = useLayoutPreferences(queueOpen);
  const preferences = personalPreferences(state.personalPreferences);
  const theme = resolveTheme(preferences, systemDark);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setSystemDark(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  const current = queue.find((e) => e.id === currentEntry)?.trackId || null;
  const [ps, setPS] = useState(idlePlayer),
    player = useRef<MusicPlayer | null>(null),
    ended = useRef(() => {}),
    latest = useRef({ state, ps });
  latest.current = { state, ps };
  const fileInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null);
  const track = tracks.find((t) => t.id === current),
    activeGroup = groups.find((g) => g.id === view),
    activeSmartGroup = smartGroups.find((g) => g.id === view),
    title =
      view === 'artists'
        ? tr('歌手')
        : view === 'albums'
        ? tr('专辑')
        : view === 'all'
          ? tr('全部音乐')
          : view === 'none'
            ? tr('未分类')
            : activeGroup?.name || activeSmartGroup?.name || tr('全部音乐');
  const cover = useCover(track, library.resolveFile);
  const organizeCover = useCover(editingTrack, library.resolveFile);
  const songInfo = useSongMetadata(track, library.resolveFile);
  const activeSmartTrackIds = new Set(activeSmartGroup?.trackIds || []);
  useEffect(() => {
    const query = search.trim();
    const clientId = preferences.jamendoClientId || '';
    setOnlineResults([]);
    if (query.length < 2) {
      setOnlineStatus('idle');
      return;
    }
    if (!clientId) {
      setOnlineStatus('needs-client-id');
      return;
    }
    const controller = new AbortController();
    setOnlineStatus('loading');
    const timer = setTimeout(() => {
      void searchJamendo(clientId, query, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return;
          setOnlineResults(results);
          setOnlineStatus(results.length ? 'ready' : 'empty');
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setOnlineStatus('error');
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, preferences.jamendoClientId]);
  const visualization = useVisualizationWindow(
    player,
    preferences.visualizationStyle || 'bars',
    setNotice,
    theme.accent,
    mainPage === 'focus',
  );
  function showFocusPage() {
    if (mainPage === 'focus') return;
    void desktopLyrics.hide();
    if (visualization.opened) visualization.toggle();
    setLyricsOpen(false);
    setMainPage('focus');
  }
  const plannedEntry = useMemo(
    () =>
      queue[
        nextEntryIndex(
          queue,
          currentEntry,
          mode,
          false,
          true,
          Math.random,
          state.playOrder,
        )
      ],
    [queue, currentEntry, mode, state.playOrder],
  );
  const plannedTrack = tracks.find((t) => t.id === plannedEntry?.trackId);
  const resolveFile = resolveAudio;
  const visible = tracks
    .filter(
      (t) =>
        !t.catalog &&
        (view === 'all' ||
          (view === 'none'
            ? t.groups.length === 0
            : activeSmartGroup
              ? activeSmartTrackIds.has(t.id)
              : t.groups.includes(view))) &&
        t.name.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  const playing = ps.status === 'playing' || ps.status === 'buffering',
    preparing = ps.status === 'preparing';
  const position = ps.status === 'idle' ? state.position : ps.position;
  const desktopLyricsSnapshot = useMemo(
    () =>
      makeDesktopLyricsSnapshot({
        trackName: track?.name || '',
        lyrics: track?.lyrics,
        positionSeconds: position,
        fontSize: state.lyricsWindowPreferences?.fontSize || 28,
        fontFamily: state.lyricsWindowPreferences?.fontFamily || 'sans',
        language: state.personalPreferences?.language || 'zh-CN',
        accentColor: theme.accent,
      }),
    [
      track?.name,
      track?.lyrics,
      position,
      state.lyricsWindowPreferences?.fontSize,
      state.lyricsWindowPreferences?.fontFamily,
      theme.accent,
    ],
  );
  const desktopLyricsSnapshotRef = useRef(desktopLyricsSnapshot);
  desktopLyricsSnapshotRef.current = desktopLyricsSnapshot;
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const listener = await listen(DESKTOP_LYRICS_REQUEST_EVENT, () => {
        void emit(DESKTOP_LYRICS_EVENT, desktopLyricsSnapshotRef.current);
      });
      if (alive) unlisten = listener;
      else listener();
      if (alive)
        void emit(DESKTOP_LYRICS_EVENT, desktopLyricsSnapshotRef.current);
    })();
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    if (isTauri()) void emit(DESKTOP_LYRICS_EVENT, desktopLyricsSnapshot);
  }, [desktopLyricsSnapshot]);
  const setTracks = (fn: Track[] | ((ts: Track[]) => Track[])) =>
    update((s) => ({
      ...s,
      tracks: typeof fn === 'function' ? fn(s.tracks) : fn,
    }));
  const setGroups = (fn: Group[] | ((gs: Group[]) => Group[])) =>
    update((s) => ({
      ...s,
      groups: typeof fn === 'function' ? fn(s.groups) : fn,
    }));
  const setQueue = (fn: (q: QueueEntry[]) => QueueEntry[], nextUp = false) =>
    update((s) => {
      const entries = fn(s.queue);
      const order =
        isTauri() && s.mode === 1
          ? reconcileAddedPlayOrder(
              entries,
              s.queue,
              s.playOrder,
              s.currentEntry,
              nextUp,
            )
          : undefined;
      return {
        ...s,
        queue: entries,
        playOrder: isTauri() && s.mode === 1 ? order : undefined,
      };
    });
  const setVolume = (v: number) => update((s) => ({ ...s, volume: v }));
  const setMode = (fn: (m: number) => number) =>
    update((s) => {
      const next = fn(s.mode);
      return {
        ...s,
        mode: next,
        playOrder:
          isTauri() && next === 1
            ? arrangeQueue(s.queue, s.currentEntry, next)
            : undefined,
      };
    });
  const notify = (s: string) => setNotice(s);
  useEffect(() => {
    player.current = new MusicPlayer(setPS, () => ended.current());
    return () => player.current?.destroy();
  }, []);
  useEffect(() => {
    const entry = plannedEntry,
      nextTrack = plannedTrack;
    player.current?.configure(
      preferences.crossfade && mode !== 2,
      preferences.crossfadeSeconds,
      entry && nextTrack
        ? {
            key: entry.id,
            track: nextTrack,
            resolve: () => resolveFile(nextTrack),
            activate: () =>
              update((s) => ({ ...s, currentEntry: entry.id, position: 0 })),
          }
        : undefined,
    );
  }, [
    plannedEntry,
    plannedTrack,
    mode,
    preferences.crossfade,
    preferences.crossfadeSeconds,
    resolveFile,
    update,
  ]);
  useEffect(() => {
    player.current?.setVolume(volume / 100);
  }, [volume]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    setSelected([]);
  }, [view, search]);
  useEffect(() => {
    if (
      ps.duration > 0 &&
      current &&
      track?.duration !== ps.duration &&
      ps.status !== 'idle'
    )
      setTracks((ts) =>
        ts.map((t) => (t.id === current ? { ...t, duration: ps.duration } : t)),
      );
  }, [ps.duration, current]);
  useEffect(() => {
    const save = () => {
      const { ps, state } = latest.current;
      if (ps.status !== 'idle' && Math.abs(state.position - ps.position) > 0.25)
        update((s) => ({ ...s, position: ps.position }));
    };
    const t = setInterval(save, 2000);
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', save);
    return () => {
      clearInterval(t);
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', save);
    };
  }, [update]);
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (tool: object, options: object) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'start_music_import',
            title: tr('打开音乐导入'),
            description: tr('打开导入界面，仍需用户选择并授权本机文件。'),
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: false },
            execute: (input: unknown) => {
              if (
                !input ||
                typeof input !== 'object' ||
                Array.isArray(input) ||
                Object.keys(input).length
              )
                throw new Error(tr('请输入空对象'));
              flushSync(() => setModal('import'));
              return { status: 'import_dialog_open' };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);
  async function start(
    id: string,
    newQueue?: string[],
    at = 0,
    entryId?: string,
  ) {
    if (!ready || readOnly) return;
    const t = library.trackById(id) || tracks.find((x) => x.id === id);
    if (!t) return;
    const entries = newQueue ? newQueue.map(makeEntry) : [...queue];
    let target = entryId
      ? entries.find((e) => e.id === entryId)
      : entries.find((e) => e.trackId === id);
    if (!target) {
      target = makeEntry(id);
      entries.push(target);
    }
    update((s) => ({
      ...s,
      queue: entries,
      playOrder:
        isTauri() && s.mode === 1
          ? newQueue
            ? arrangeQueue(entries, target!.id, s.mode)
            : reconcilePlayOrder(entries, s.playOrder, s.currentEntry)
          : undefined,
      currentEntry: target!.id,
      position: at,
    }));
    await player.current?.load(t, () => resolveAudio(t), at);
  }
  function addJamendoTrack(item: JamendoResult, playImmediately: boolean) {
    if (!ready || readOnly) return;
    const onlineTrack = jamendoTrack(item);
    library.update((s) => ({
      ...s,
      tracks: [
        ...s.tracks.filter((track) => track.id !== onlineTrack.id),
        onlineTrack,
      ],
    }));
    if (playImmediately) void start(onlineTrack.id);
    else setQueue((entries) => [...entries, makeEntry(onlineTrack.id)]);
  }
  function next(back = false, ended = false) {
    const i = nextEntryIndex(
      queue,
      currentEntry,
      mode,
      back,
      ended,
      Math.random,
      state.playOrder,
    );
    if (i < 0) return;
    const e = queue[i];
    void start(e.trackId, undefined, 0, e.id);
  }
  ended.current = () => next(false, true);
  function toggle() {
    if (preparing) {
      player.current?.cancel();
      return;
    }
    if (playing) {
      player.current?.pause();
      return;
    }
    if (ps.status === 'paused' && ps.message !== '已取消准备') {
      void player.current?.resume();
      return;
    }
    if (current)
      void start(
        current,
        undefined,
        position >= (track?.duration || 0) ? 0 : position,
        currentEntry || undefined,
      );
    else if (visible[0])
      void start(
        visible[0].id,
        visible.map((t) => t.id),
      );
  }
  const miniPlayer = useMiniPlayer(
    {
      trackId: track?.id || '',
      name: track?.name || '',
      playing,
      preparing,
      position,
      duration: track?.duration || ps.duration || 0,
      volume,
      canPlay: ready && !readOnly && tracks.length > 0,
      canSkip: ready && !readOnly && queue.length > 0,
      version: track?.playbackVersion || 'original',
      dark: theme.dark,
      accent: theme.accent,
      accentText: theme.accentText,
      language: getLanguage(),
      message: ps.status === 'error' ? ps.message : '',
    },
    cover.url,
    (action) => {
      if (!ready || readOnly) return;
      if (action.type === 'toggle') toggle();
      else if (action.type === 'previous') next(true);
      else if (action.type === 'next') next();
      else if (action.type === 'volume') setVolume(action.value);
      else if (action.type === 'seek' && !preparing && track?.duration) {
        const at = Math.min(action.value, track.duration);
        if (ps.status === 'idle') update((s) => ({ ...s, position: at }));
        else player.current?.seek(at);
      }
    },
    setNotice,
  );

  function importFiles(files: File[]) {
    library.importFiles(files);
    setModal('');
  }
  function openIdentification(target: Track) {
    const credits = effectiveCredits(target);
    setEditId(target.id);
    setArtistDraft(credits.artists.join('\n'));
    setAlbumDraft(credits.album);
    setAlbumArtistDraft(credits.albumArtists.join('\n'));
    setAcoustIdKeyDraft(state.acoustIdClientKey || '');
    setFingerprintMessage('');
    setModal('identify');
  }
  function changeLanguage(language: 'zh-CN' | 'en') {
    if (!ready || readOnly) return;
    update((s) => ({
      ...s,
      personalPreferences: {
        ...personalPreferences(s.personalPreferences),
        language,
      },
    }));
    setLanguage(language);
  }
  async function organize(kind: SmartGroupKind) {
    if (!ready || readOnly || organizing) return;
    const controller = new AbortController();
    organizeAbort.current = controller;
    if (kind === 'folder') {
      update((s) => ({
        ...s,
        smartGroups: [
          ...(s.smartGroups || []).filter((group) => group.kind !== kind),
          ...folderGroups(
            s.roots,
            s.tracks.filter((item) => !item.catalog),
          ),
        ],
      }));
      notify('已按文件夹整理音乐库。');
      organizeAbort.current = null;
      return;
    }
    const local = tracks.filter((item) => !item.catalog);
    const rows: {
      id: string;
      artists: string[];
      album?: string;
      albumArtists: string[];
    }[] = [];
    let failures = 0;
    setOrganizing({ kind, done: 0, total: local.length });
    try {
      for (const [index, item] of local.entries()) {
        if (controller.signal.aborted) return;
        try {
          const { info, warning } = await readSongMetadata(item, () =>
            library.resolveFile(item),
          );
          const credits = effectiveCredits({
            ...item,
            identification: {
              ...item.identification,
              file: {
                artists: info.artists,
                album: info.album,
                albumArtists: info.albumArtists || [],
              },
            },
          });
          rows.push({ id: item.id, ...credits });
          if (warning) failures++;
        } catch {
          rows.push({ id: item.id, ...effectiveCredits(item) });
          failures++;
        }
        setOrganizing({ kind, done: index + 1, total: local.length });
      }
      if (controller.signal.aborted) return;
      const result = metadataGroups(kind, rows);
      update((s) => ({
        ...s,
        smartGroups: [
          ...(s.smartGroups || []).filter((group) => group.kind !== kind),
          ...result,
        ],
      }));
      notify(
        failures
          ? message('整理完成，{0} 首歌曲资料无法验证，已归入信息未知。', {
              0: failures,
            })
          : '音乐库整理完成。',
      );
    } finally {
      organizeAbort.current = null;
      setOrganizing(null);
    }
  }
  function saveGroup() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (
      groups.some(
        (g) => g.name === trimmed && !(modal === 'rename' && g.id === view),
      )
    ) {
      notify('已有同名分类，请换一个名称。');
      return;
    }
    if (modal === 'rename')
      setGroups((gs) =>
        gs.map((g) => (g.id === view ? { ...g, name: trimmed } : g)),
      );
    else {
      const id = crypto.randomUUID();
      setGroups((gs) => [...gs, { id, name: trimmed }]);
      setView(id);
    }
    setModal('');
  }
  function assign() {
    setTracks((ts) =>
      ts.map((t) =>
        selected.includes(t.id)
          ? { ...t, groups: [...new Set([...t.groups, ...targets])] }
          : t,
      ),
    );
    notify(message('已为 {0} 首音乐添加分类', { 0: selected.length }));
    setModal('');
    setSelected([]);
  }
  function moveGroup(delta: number) {
    setGroups((gs) => {
      const i = gs.findIndex((g) => g.id === view),
        j = i + delta;
      if (j < 0 || j >= gs.length) return gs;
      const copy = [...gs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }
  const nav = (
    id: string,
    label: string,
    count: number,
    icon: React.ReactNode,
  ) => (
    <SidebarMenuItem key={id}>
      <SidebarMenuButton
        size="lg"
        isActive={view === id}
        onClick={() => setView(id)}
        className="nav-item"
      >
        {icon}
        <span>{label}</span>
        <span className="nav-count">{count}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
  const artistGroups = smartGroups.filter((group) => group.kind === 'artist');
  const navigation = (
    <Sidebar collapsible="none">
      <div className="brand"><span className="brand-icon"><AudioLines size={25} /></span><div>{tr('自用')}<span>LOCAL MUSIC</span></div></div>
      <SidebarContent>
        <div className="nav-heading">{tr('音乐库')}</div>
        <SidebarMenu>
          {nav('all', tr('全部音乐'), tracks.filter((t) => !t.catalog).length, <Library />)}
          {nav('albums', tr('专辑'), albumCount, <Music2 />)}
          {nav('artists', tr('歌手'), artistGroups.length, <AudioLines />)}
        </SidebarMenu>
        <details className="nav-section compact-categories">
          <summary className="nav-heading">{tr('我的分类')}</summary>
          <SidebarMenu>
            {nav('none', tr('未分类'), tracks.filter((t) => !t.catalog && !t.groups.length).length, <Folder />)}
            {groups.map((g) => nav(g.id, g.name, tracks.filter((t) => !t.catalog && t.groups.includes(g.id)).length, <Folder />))}
            {smartGroups.filter((g) => g.kind === 'folder').map((g) => nav(g.id, g.name, g.trackIds.filter((id) => knownTrackIds.has(id)).length, <Folder />))}
          </SidebarMenu>
          <button className="create-group" onClick={() => { setName(''); setModal('new'); }}><Plus size={16} />{tr('新建分类')}</button>
        </details>
      </SidebarContent>
      <button className="create-group folder-manager" onClick={() => setModal('preferences')}><Settings2 size={16} />{tr('设置')}</button>
      <div className="sidebar-foot"><span className="live-dot" />{tr('本地音乐，自己收藏')}<span>{tr(`本地音乐播放器 · v${isTauri() ? '0.17.0' : '0.8'}`)}</span></div>
    </Sidebar>
  );
  const queuePanel = queueOpen ? (
    <div className="flow-queue-content">
      <div className="flow-queue-heading">
        <h2>
          {tr('待播放列表')} <span className="muted">{queue.length}</span>
        </h2>
        <Button
          variant="ghost"
          aria-label={tr('关闭播放列表')}
          onClick={() => setQueueOpen(false)}
        >
          {tr('关闭')}
        </Button>
      </div>
      <p>{tr('浏览其他分类不会打断当前队列。')}</p>
      <div className="queue-items">
        {queue.length ? (
          orderedQueue.map((entry, i) => {
            const t = tracks.find((x) => x.id === entry.trackId);
            return (
              t && (
                <button
                  key={entry.id}
                  className={currentEntry === entry.id ? 'accent' : ''}
                  onClick={() => start(entry.trackId, undefined, 0, entry.id)}
                >
                  <span>
                    {currentEntry === entry.id
                      ? mode === 2
                        ? tr('单曲循环')
                        : tr('正在播放')
                      : i + 1}
                  </span>
                  <span>{t.name}</span>
                  <Play size={16} />
                </button>
              )
            );
          })
        ) : (
          <p className="muted">{tr('播放一首音乐，或将音乐加入队列。')}</p>
        )}
      </div>
    </div>
  ) : undefined;
  return (
    <SidebarProvider
      data-ui-theme={isTauri() ? (theme.dark ? 'dark' : 'light') : 'legacy'}
      style={
        {
          '--player-height': `${layout.playerHeight}px`,
          '--ui-accent': isTauri() ? theme.accent : undefined,
          '--ui-background': isTauri() ? theme.background : undefined,
          '--primary': isTauri() ? theme.accent : undefined,
          '--ring': isTauri() ? theme.accent : undefined,
        } as CSSProperties
      }
      className={
        preferences.coverBackground && cover.url ? 'has-cover-background' : ''
      }
    >
      {preferences.coverBackground && cover.url && (
        <div
          className="song-background"
          style={{ backgroundImage: `url("${cover.url}")` }}
          aria-hidden="true"
        />
      )}
      <PersonalPreferencesDialog
        extra={
          <>
            <div className="settings-shortcuts">
              <Button variant="outline" onClick={() => setModal('folders')}>{tr('音乐文件夹')}</Button>
              <Button variant="outline" disabled={!ready || readOnly || !temporaryCount} onClick={() => setModal('clear-temporary')}>{tr('清除临时音乐')} ({temporaryCount})</Button>
            </div>
            <LayoutPreferencesControls
              value={layout.value}
              onChange={layout.change}
            />
            {isTauri() ? (
              <VocalPanel
                vocals={vocals}
                disabled={!ready || readOnly}
                onCacheCleared={clearVocalSelection}
              />
            ) : undefined}
          </>
        }
        open={modal === 'preferences'}
        onOpenChange={(open) => setModal(open ? 'preferences' : '')}
        value={preferences}
        disabled={!ready || readOnly}
        onChange={(value) =>
          update((s) => ({ ...s, personalPreferences: value }))
        }
      />
      {modal === 'cover' && (
        <CoverPanel
          key={coverFromOrganize ? editingTrack?.id : track?.id}
          open
          onOpenChange={(open) =>
            setModal(open ? 'cover' : coverFromOrganize ? 'identify' : '')
          }
          track={coverFromOrganize ? editingTrack : track}
          record={coverFromOrganize ? organizeCover.record : cover.record}
          url={coverFromOrganize ? organizeCover.url : cover.url}
          disabled={
            !ready || readOnly || !(coverFromOrganize ? editingTrack : track)
          }
          onSaved={() => {
            (coverFromOrganize ? organizeCover.refresh : cover.refresh)();
            setAlbumCoverRevision((v) => v + 1);
          }}
        />
      )}
      <span data-testid="library-ready" hidden>
        {ready ? 'ready' : 'loading'}
      </span>
      <FlowWorkspace
        active={mainPage === 'library'}
        navigation={navigation}
        navScale={layout.navScale}
        collapsed={layout.value.navCollapsed}
        onToggle={() =>
          layout.change({ navCollapsed: !layout.value.navCollapsed })
        }
        rail={
          <>
            <button
              aria-label={tr('全部音乐')}
              title={tr('全部音乐')}
              aria-pressed={view === 'all'}
              onClick={() => setView('all')}
            >
              <Library size={20} />
            </button>
            <button
              aria-label={tr('专辑')}
              title={tr('专辑')}
              aria-pressed={view === 'albums'}
              onClick={() => setView('albums')}
            >
              <Music2 size={20} />
            </button>
            <button
              aria-label={tr('歌手')}
              title={tr('歌手')}
              onClick={() => setView('artists')}
            >
              <Folder size={20} />
            </button>
            <button
              aria-label={tr('设置')}
              title={tr('设置')}
              onClick={() => setModal('preferences')}
            >
              <Settings2 size={20} />
            </button>
          </>
        }
        queue={queuePanel}
        className={`workspace ${mainPage === 'focus' ? 'workspace-focus' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes('Files')) setDrag(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDrag(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          importFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <header className="topbar">
          <div className="breadcrumb">
            <SidebarTrigger />
            {isTauri() ? (
              <div
                className="main-page-tabs"
                role="tablist"
                aria-label={tr('主页面')}
              >
                <button
                  role="tab"
                  aria-selected={mainPage === 'library'}
                  onClick={() => setMainPage('library')}
                >
                  {tr('音乐库')}
                </button>
                <button
                  role="tab"
                  aria-selected={mainPage === 'focus'}
                  onClick={showFocusPage}
                >
                  {tr('专心听歌')}
                </button>
              </div>
            ) : (
              <>
                <span>{tr('我的音乐')}</span>
                <span>/</span>
                <strong>{title}</strong>
              </>
            )}
          </div>
          <div className="top-actions">
            {isTauri() && (
              <Button
                variant="ghost"
                aria-label={tr('主题调色板')}
                title={tr('主题调色板')}
                onClick={() => setModal('preferences')}
              >
                <Palette size={17} />
              </Button>
            )}
            <div
              className="language-switch"
              role="group"
              aria-label={tr('切换语言')}
            >
              <button
                className={getLanguage() === 'zh-CN' ? 'active' : ''}
                disabled={!ready || readOnly}
                onClick={() => changeLanguage('zh-CN')}
                aria-pressed={getLanguage() === 'zh-CN'}
              >
                中文
              </button>
              <span>/</span>
              <button
                className={getLanguage() === 'en' ? 'active' : ''}
                disabled={!ready || readOnly}
                onClick={() => changeLanguage('en')}
                aria-pressed={getLanguage() === 'en'}
              >
                EN
              </button>
            </div>
            {!(mainPage === 'library' && view === 'albums') && (
              <div className="search">
                <Search size={17} />
                <Input
                  aria-label={tr('搜索本地及在线音乐')}
                  placeholder={tr('搜索音乐或歌手…')}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    if (mainPage === 'focus') setFocusChooserOpen(true);
                  }}
                />
              </div>
            )}
            <Button onClick={() => setModal('import')}>
              <Plus size={17} />
              {tr('导入音乐')}
            </Button>
          </div>
        </header>
        {mainPage === 'library' && view === 'artists' ? (
          <section className="library">
            <h1>{tr('歌手')}</h1>
            <p className="muted">{tr('按歌手浏览收藏，点击歌手查看歌曲。')}</p>
            <Button variant="outline" disabled={!ready || readOnly || !!organizing} onClick={() => void organize('artist')}>{tr('按歌手整理')}</Button>
            {organizing && <output className="library-banner">{tr('正在整理')} {organizing.done}/{organizing.total}<Button variant="ghost" onClick={() => organizeAbort.current?.abort()}>{tr('取消')}</Button></output>}
            <div className="artist-browser">
              {artistGroups.map((group) => <button key={group.id} onClick={() => setView(group.id)}><AudioLines size={22} /><strong>{group.name}</strong><span>{group.trackIds.filter((id) => knownTrackIds.has(id)).length} {tr('首')}</span></button>)}
            </div>
            {!artistGroups.length && <p className="muted">{tr('点击“按歌手整理”建立歌手列表，原有分类和队列会保留。')}</p>}
          </section>
        ) : mainPage === 'library' && view === 'albums' ? (
          <AlbumBrowser
            tracks={tracks}
            metadata={albumData.metadata}
            resolve={library.resolveFile}
            current={current}
            disabled={!ready || readOnly}
            loading={albumData.loading}
            failed={albumData.failed}
            onRetry={albumData.retry}
            onPlay={(id, ids) => void start(id, ids)}
            onQueue={(ids) => setQueue((q) => [...q, ...ids.map(makeEntry)])}
            onEdit={(id) => {
              const item = tracks.find((t) => t.id === id);
              if (item) openIdentification(item);
            }}
            coverRevision={albumCoverRevision}
          />
        ) : mainPage === 'library' ? (
          <section className="library">
            {!ready && (
              <div className="library-banner">{tr('正在恢复音乐库…')}</div>
            )}
            {readOnly && (
              <div className="library-banner warning">
                {storageError ||
                  tr(
                    '另一个自用页面正在管理音乐库。请关闭它，再刷新此页面，避免覆盖修改。',
                  )}
              </div>
            )}
            {storageError && !readOnly && (
              <div className="library-banner warning">
                {tr(storageError)}
                <Button variant="outline" onClick={library.retrySave}>
                  {tr('重试保存')}
                </Button>
              </div>
            )}
            {busy && (
              <div className="library-banner" role="status">
                {tr(busy)}
                <Button variant="ghost" onClick={library.cancelScan}>
                  {tr('取消扫描')}
                </Button>
              </div>
            )}
            {state.roots.some(
              (r) =>
                library.permissions[r.id] &&
                library.permissions[r.id] !== 'granted',
            ) && (
              <div className="library-banner warning">
                {tr('有音乐文件夹需要重新授权，已有分类已保留。')}
                <Button variant="outline" onClick={() => setModal('folders')}>
                  {tr('恢复访问')}
                </Button>
              </div>
            )}
            {(ps.message || ps.status === 'preparing') && (
              <div
                className={
                  'library-banner ' + (ps.status === 'error' ? 'warning' : '')
                }
                role="status"
              >
                {tr(ps.message)}
                {(ps.status === 'preparing' || ps.status === 'buffering') && (
                  <Button
                    variant="ghost"
                    onClick={() => player.current?.cancel()}
                  >
                    {tr('取消播放')}
                  </Button>
                )}
              </div>
            )}
            <div className="library-heading">
              <div>
                <div className="eyebrow">YOUR COLLECTION</div>
                <h1>
                  {title}
                  <span>{visible.length}</span>
                </h1>
                <p>
                  {view === 'none'
                    ? tr('给这些音乐找一个喜欢的分类。')
                    : view === 'all'
                      ? tr('每一首，都是你自己的选择。')
                      : tr('属于这一刻的声音。')}
                </p>
              </div>
              <span className="collection-mark">
                <AudioLines size={54} strokeWidth={1} />
              </span>
            </div>
            <div className="actions">
              <Button
                disabled={!ready || readOnly || !visible.length}
                onClick={() =>
                  start(
                    visible[0].id,
                    visible.map((t) => t.id),
                  )
                }
              >
                <Play size={15} fill="currentColor" />
                {tr('播放全部')}
              </Button>
              <Button
                variant="outline"
                disabled={!ready || readOnly || !selected.length}
                onClick={() => {
                  setTargets([]);
                  setModal('assign');
                }}
              >
                <FolderPlus size={16} />
                {tr('添加到分类')}
                {selected.length ? ` (${selected.length})` : ''}
              </Button>
              {isTauri() && selected.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    disabled={readOnly || !ready}
                    onClick={() => {
                      const ids = visible
                        .filter((item) => selected.includes(item.id))
                        .map((item) => item.id);
                      setQueue((old) => {
                        const entries = [...old];
                        const at = Math.max(
                          0,
                          entries.findIndex(
                            (item) => item.id === currentEntry,
                          ) + 1,
                        );
                        entries.splice(at, 0, ...ids.map(makeEntry));
                        return entries;
                      }, true);
                      notify(message('{0} 首歌曲已安排下一首播放', {0:ids.length}));
                    }}
                  >
                    {tr('下一首播放')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={readOnly || !ready}
                    onClick={() => {
                      const ids = visible
                        .filter((item) => selected.includes(item.id))
                        .map((item) => item.id);
                      setQueue((old) => [...old, ...ids.map(makeEntry)]);
                      notify(message('{0} 首歌曲已加入队列', {0:ids.length}));
                    }}
                  >
                    {tr('加入队列')}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={readOnly || !ready}
                    onClick={() => setModal('remove-selected')}
                  >
                    {tr('从音乐库移除')}
                  </Button>
                </>
              )}
              {isTauri() && (
                <details className="library-tools-menu">
                  <summary>{tr('音乐库工具')}</summary>
                  {(['folder', 'artist', 'album'] as const).map((kind) => <Button key={kind} variant="ghost" disabled={!ready || readOnly || !!organizing} onClick={() => void organize(kind)}>{tr(({folder:'按文件夹整理',artist:'按歌手整理',album:'按专辑整理'})[kind])}</Button>)}
                  {organizing && <output className="library-banner">{tr('正在整理')} {organizing.done}/{organizing.total}<Button variant="ghost" onClick={() => organizeAbort.current?.abort()}>{tr('取消')}</Button></output>}
                  <Button
                    variant="ghost"
                    disabled={!ready || readOnly || !temporaryCount}
                    onClick={() => setModal('clear-temporary')}
                  >
                    {tr('清除临时音乐')} ({temporaryCount})
                  </Button>
                  {isTauri() &&
                    (identification.progress || identification.paused) && (
                      <Button
                        variant="ghost"
                        onClick={identification.togglePaused}
                      >
                        {identification.paused
                          ? tr('继续识别')
                          : `${tr('暂停识别')} ${identification.progress?.done || 0}/${identification.progress?.total || 0}`}
                      </Button>
                    )}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void (desktopLyrics.shown.current
                        ? desktopLyrics.hidePart('current')
                        : desktopLyrics.showPart('current'));
                    }}
                  >
                    {tr(desktopLyrics.shown.current ? '隐藏歌词 1' : '显示歌词 1')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void (desktopLyrics.shown.next
                        ? desktopLyrics.hidePart('next')
                        : desktopLyrics.showPart('next'));
                    }}
                  >
                    {tr(desktopLyrics.shown.next ? '隐藏歌词 2' : '显示歌词 2')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void desktopLyrics.resetPositions();
                    }}
                  >
                    {tr('重置歌词位置')}
                  </Button>
                </details>
              )}
              <div className="actions-right">
                {activeGroup && (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setName(activeGroup.name);
                        setModal('rename');
                      }}
                    >
                      {tr('改名')}
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={tr('分类上移')}
                      disabled={
                        !ready ||
                        readOnly ||
                        groups.findIndex((group) => group.id === view) <= 0
                      }
                      onClick={() => moveGroup(-1)}
                    >
                      <ArrowUp size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={tr('分类下移')}
                      disabled={
                        !ready ||
                        readOnly ||
                        groups.findIndex((group) => group.id === view) >=
                          groups.length - 1
                      }
                      onClick={() => moveGroup(1)}
                    >
                      <ArrowDown size={15} />
                    </Button>
                    <Button variant="ghost" onClick={() => setModal('delete')}>
                      {tr('删除分类')}
                    </Button>
                  </>
                )}
                <span>
                  {selected.length
                    ? tr(message('已选 {0} 首', { 0: selected.length }))
                    : tr('按文件名排序')}
                </span>
              </div>
            </div>
            {search.trim() && (
              <div className="search-source-heading">
                <strong>{tr('本机音乐')}</strong>
                <span>{visible.length}</span>
              </div>
            )}
            <Table className={isTauri() ? 'desktop-track-table' : undefined}>
              <TableHeader>
                <TableRow>
                  <TableHead className="check-cell">
                    <Checkbox
                      aria-label={tr('全选当前列表')}
                      checked={
                        !!visible.length &&
                        visible.every((t) => selected.includes(t.id))
                      }
                      onCheckedChange={(checked) =>
                        setSelected(checked ? visible.map((t) => t.id) : [])
                      }
                    />
                  </TableHead>
                  <TableHead className="index-cell">#</TableHead>
                  <TableHead>{tr('文件名')}</TableHead>
                  <TableHead className="format-cell">{tr('格式')}</TableHead>
                  <TableHead className="group-cell">{tr('分类')}</TableHead>
                  <TableHead>{tr('时长')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((t, i) => (
                  <TableRow
                    key={t.id}
                    className={current === t.id ? 'current-row' : ''}
                    onDoubleClick={() =>
                      start(
                        t.id,
                        visible.map((t) => t.id),
                      )
                    }
                  >
                    <TableCell>
                      <Checkbox
                        aria-label={tr(message('选择 {0}', { 0: t.name }))}
                        checked={selected.includes(t.id)}
                        onCheckedChange={(checked) =>
                          setSelected((s) =>
                            checked
                              ? [...s, t.id]
                              : s.filter((id) => id !== t.id),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="track-index">
                      <button
                        aria-label={tr(message('播放 {0}', { 0: t.name }))}
                        onClick={() =>
                          start(
                            t.id,
                            visible.map((t) => t.id),
                          )
                        }
                      >
                        {current === t.id && playing ? (
                          <AudioLines size={17} />
                        ) : (
                          <>
                            <span>{String(i + 1).padStart(2, '0')}</span>
                            <Play className="row-play" size={16} />
                          </>
                        )}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="file-name" title={t.name}>
                        {t.name}
                      </div>
                      <div className="file-sub">
                        {t.missing
                          ? tr('文件暂不可用')
                          : t.rootId
                            ? state.roots.find((r) => r.id === t.rootId)?.name +
                              ' / ' +
                              t.path
                            : tr('临时文件 · 刷新后需重新选择')}
                      </div>
                    </TableCell>
                    <TableCell className="format-cell">
                      <span
                        className={'format format-' + t.format.toLowerCase()}
                      >
                        {t.format}
                      </span>
                    </TableCell>
                    <TableCell className="group-cell">
                      <div className="tags">
                        {t.groups
                          .map((id) => groups.find((group) => group.id === id))
                          .filter((group) => !!group)
                          .map((group) => (
                            <span key={group.id}>{group.name}</span>
                          ))}
                        {smartTags.get(t.id)?.map((group) => (
                          <button
                            key={group.id}
                            type="button"
                            className={`smart-group-tag smart-group-tag-${group.kind}`}
                            aria-label={`${tr(group.kind === 'artist' ? '歌手' : '专辑')}：${group.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setView(group.id);
                            }}
                            onDoubleClick={(event) => event.stopPropagation()}
                          >
                            <span>
                              {tr(group.kind === 'artist' ? '歌手' : '专辑')}
                            </span>
                            {group.name === '信息未知'
                              ? tr('信息未知')
                              : group.name}
                          </button>
                        ))}
                        {isTauri() &&
                          t.identification?.status === 'needs-review' && (
                            <button
                              type="button"
                              className="identify-review-tag"
                              onClick={(event) => {
                                event.stopPropagation();
                                openIdentification(t);
                              }}
                              onDoubleClick={(event) => event.stopPropagation()}
                            >
                              {tr('待确认')}
                            </button>
                          )}
                        {!t.groups.some((id) =>
                          groups.some((group) => group.id === id),
                        ) &&
                          !smartTags.has(t.id) &&
                          t.identification?.status !== 'needs-review' && (
                            <span className="no-tag">—</span>
                          )}
                      </div>
                    </TableCell>
                    <TableCell className="duration">
                      {t.duration ? clock(t.duration) : '—'}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <button
                              className="icon-button"
                              aria-label={tr(
                                message('{0} 的操作', { 0: t.name }),
                              )}
                            />
                          }
                        >
                          <MoreHorizontal size={18} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setSelected([t.id]);
                              setTargets([]);
                              setModal('assign');
                            }}
                          >
                            {tr('添加到分类')}
                          </DropdownMenuItem>
                          {isTauri() && (
                            <DropdownMenuItem
                              onClick={() => openIdentification(t)}
                            >
                              {tr('整理歌曲')}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            disabled={!ready || readOnly}
                            onClick={() => {
                              setQueue((q) => {
                                const c = [...q];
                                c.splice(
                                  Math.max(
                                    0,
                                    c.findIndex((e) => e.id === currentEntry) +
                                      1,
                                  ),
                                  0,
                                  makeEntry(t.id),
                                );
                                return c;
                              }, true);
                              notify('已安排下一首播放');
                            }}
                          >
                            {tr('下一首播放')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!ready || readOnly}
                            onClick={() => {
                              setQueue((q) => [...q, makeEntry(t.id)]);
                              notify('已加入队列');
                            }}
                          >
                            {tr('加入队列')}
                          </DropdownMenuItem>
                          {activeGroup && (
                            <DropdownMenuItem
                              onClick={() =>
                                setTracks((ts) =>
                                  ts.map((x) =>
                                    x.id === t.id
                                      ? {
                                          ...x,
                                          groups: x.groups.filter(
                                            (g) => g !== view,
                                          ),
                                        }
                                      : x,
                                  ),
                                )
                              }
                            >
                              {tr('从当前分类移除')}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={readOnly || !ready}
                            onClick={() => {
                              setRemoveId(t.id);
                              setModal('remove-track');
                            }}
                          >
                            {tr('从音乐库移除')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {search.trim().length >= 2 && (
              <section
                className="online-results"
                aria-label={tr('在线免费音乐')}
              >
                <div className="online-results-heading">
                  <div>
                    <h2>{tr('在线免费音乐')}</h2>
                    <span>Jamendo · Creative Commons</span>
                  </div>
                  {onlineStatus === 'ready' && (
                    <span>{onlineResults.length}</span>
                  )}
                </div>
                {onlineStatus === 'needs-client-id' && (
                  <div className="online-results-note">
                    <p>{tr('请在个人偏好中填写 Jamendo Client ID。')}</p>
                    <Button
                      variant="outline"
                      onClick={() => setModal('preferences')}
                    >
                      <Settings2 size={15} />
                      {tr('个人偏好')}
                    </Button>
                  </div>
                )}
                {onlineStatus === 'loading' && (
                  <p className="online-results-note">
                    {tr('正在搜索免费曲库…')}
                  </p>
                )}
                {onlineStatus === 'error' && (
                  <p className="online-results-note" role="status">
                    {tr('Jamendo 搜索失败，请检查网络或 Client ID。')}
                  </p>
                )}
                {onlineStatus === 'empty' && (
                  <p className="online-results-note">
                    {tr('没有找到在线音乐。')}
                  </p>
                )}
                {onlineResults.map((item) => (
                  <article className="online-result" key={item.id}>
                    <button
                      className="online-result-main"
                      disabled={!ready || readOnly}
                      aria-label={tr(message('播放 {0}', { 0: item.name }))}
                      onClick={() => addJamendoTrack(item, true)}
                    >
                      <span className="online-result-play">
                        <Play size={15} fill="currentColor" />
                      </span>
                      <span className="online-result-title">
                        <strong>{item.name}</strong>
                        <small>
                          {item.artist}
                          {item.album ? ` · ${item.album}` : ''}
                        </small>
                      </span>
                      <span className="online-result-duration">
                        {clock(item.duration)}
                      </span>
                    </button>
                    <div className="online-result-meta">
                      <a href={item.pageUrl} target="_blank" rel="noreferrer">
                        Jamendo <ExternalLink size={11} />
                      </a>
                      <a
                        href={item.licenseUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {tr('Creative Commons 许可')} <ExternalLink size={11} />
                      </a>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!ready || readOnly}
                        onClick={() => addJamendoTrack(item, false)}
                      >
                        <Plus size={14} />
                        {tr('加入队列')}
                      </Button>
                    </div>
                  </article>
                ))}
              </section>
            )}
            {!visible.length && !onlineResults.length && (
              <div className="empty">
                <Music2 size={36} />
                <h2>{search ? tr('没有找到音乐') : tr('这里还没有音乐')}</h2>
                <p>
                  {search
                    ? tr('试试其他文件名。')
                    : tr('导入音乐，或从全部音乐中添加到这个分类。')}
                </p>
                <Button
                  variant="outline"
                  onClick={() => (search ? setSearch('') : setModal('import'))}
                >
                  {search ? tr('清除搜索') : tr('导入音乐')}
                </Button>
              </div>
            )}
            <button className="drop-hint" onClick={() => setModal('import')}>
              <Upload size={17} />
              <span>{tr('拖入音乐文件，或点击导入')}</span>
              <span className="hint-secondary">
                {tr('文件留在本机，不会上传')}
              </span>
            </button>
            <p className="demo-note">
              <Info size={14} />
              {tr('绑定音乐文件夹，下次恢复音乐库。音频只在本机处理，不上传。')}
            </p>
          </section>
        ) : (
          <FocusListening
            track={track}
            coverUrl={cover.url}
            positionMs={position * 1000}
            playing={playing}
            player={player}
            preferences={preferences}
            onLayout={(listenLayout) =>
              update((s) => ({
                ...s,
                personalPreferences: {
                  ...personalPreferences(s.personalPreferences),
                  listenLayout,
                },
              }))
            }
            tracks={tracks}
            groups={groups}
            smartGroups={smartGroups}
            queue={orderedQueue}
            currentEntry={currentEntry}
            query={search}
            onQueryChange={setSearch}
            chooser={focusChooserOpen}
            onChooserChange={setFocusChooserOpen}
            onPlay={(id) =>
              start(
                id,
                tracks.filter((item) => !item.catalog).map((item) => item.id),
              )
            }
            onPlayQueue={(entry) =>
              void start(entry.trackId, undefined, 0, entry.id)
            }
            onlineResults={onlineResults}
            onPlayOnline={(item) => addJamendoTrack(item, true)}
          />
        )}
        {drag && <div className="drop-overlay">{tr('松开以导入音乐')}</div>}
      </FlowWorkspace>
      <div className="player-dock" ref={layout.dock}>
        <footer
          className={`player ${layout.value.playerCollapsed ? 'is-collapsed' : ''}`}
          style={{ zoom: layout.playerScale }}
        >
          <button
            className="player-collapse"
            aria-label={
              tr(tr(layout.value.playerCollapsed ? '展开播放栏' : '收起播放栏'))
            }
            title={tr(tr(layout.value.playerCollapsed ? '展开播放栏' : '收起播放栏'))}
            onClick={() =>
              layout.change({ playerCollapsed: !layout.value.playerCollapsed })
            }
          >
            {layout.value.playerCollapsed ? (
              <ChevronUp size={18} />
            ) : (
              <ChevronDown size={18} />
            )}
          </button>
          <div className="now-playing">
            <button
              className="track-symbol cover-button"
              aria-label={tr('歌曲封面')}
              title={tr('搜索或上传歌曲封面')}
              disabled={!track}
              onClick={() => {
                setCoverFromOrganize(false);
                setModal('cover');
              }}
            >
              {cover.url ? (
                // oxlint-disable-next-line next/no-img-element -- Local object URL; no server optimization.
                <img src={cover.url} alt={tr('当前歌曲封面')} />
              ) : (
                <AudioLines size={25} />
              )}
            </button>
            <div>
              <strong title={track?.name}>
                {track?.name || tr('选一首，开始听')}
              </strong>
              <span>
                {track
                  ? ps.path
                    ? tr(ps.path)
                    : tr(
                        message('{format} · 本地文件', {
                          format: track.format,
                        }),
                      )
                  : tr('你的音乐，随时在这里')}
              </span>
            </div>
          </div>
          <div className="transport">
            <div className="transport-buttons">
              <button
                className={mode ? 'accent' : ''}
                aria-label={
                  [tr('顺序播放'), tr('随机播放'), tr('单曲循环')][mode]
                }
                title={[tr('顺序播放'), tr('随机播放'), tr('单曲循环')][mode]}
                onClick={() => setMode((m) => (m + 1) % 3)}
              >
                {mode === 1 ? (
                  <Shuffle size={17} />
                ) : mode === 2 ? (
                  <Repeat1 size={17} />
                ) : (
                  <ListOrdered size={17} />
                )}
              </button>
              <button
                aria-label={tr('上一首')}
                disabled={!queue.length}
                onClick={() => next(true)}
              >
                <SkipBack size={20} />
              </button>
              <button
                className="main-play"
                aria-label={
                  preparing ? tr('取消准备') : playing ? tr('暂停') : tr('播放')
                }
                disabled={!ready || readOnly || !tracks.length}
                onClick={toggle}
              >
                {playing ? (
                  <Pause size={21} fill="currentColor" />
                ) : (
                  <Play size={21} fill="currentColor" />
                )}
              </button>
              <button
                aria-label={tr('下一首')}
                disabled={!queue.length}
                onClick={() => next()}
              >
                <SkipForward size={20} />
              </button>
              <button
                aria-label={tr('播放详情')}
                onClick={() => setModal('info')}
              >
                <Info size={17} />
              </button>
            </div>
            <div className="seek">
              <span>{clock(position)}</span>
              <Slider
                aria-label={tr('播放进度')}
                value={[position]}
                max={track?.duration || 1}
                disabled={!track?.duration || preparing}
                onValueCommitted={(v) => {
                  const p = Array.isArray(v) ? v[0] : v;
                  if (ps.status === 'idle')
                    update((s) => ({ ...s, position: p }));
                  else player.current?.seek(p);
                }}
              />
              <span>{clock(track?.duration || 0)}</span>
            </div>
          </div>
          <div className="player-right">
            {isTauri() && (
              <button
                aria-label={tr('迷你播放器')}
                title={tr('迷你播放器')}
                aria-pressed={miniPlayer.opened}
                className={miniPlayer.opened ? 'accent' : ''}
                onClick={() => void miniPlayer.toggle()}
              >
                <PanelTop size={19} />
              </button>
            )}
            <Volume2 size={18} />
            <Slider
              aria-label={tr('音量')}
              value={[volume]}
              onValueChange={(v) => setVolume(Array.isArray(v) ? v[0] : v)}
            />
            <button
              aria-label={tr('歌词')}
              title={tr('歌词')}
              className={lyricsOpen ? 'accent' : ''}
              disabled={!track}
              onClick={() => {
                setQueueOpen(false);
                setLyricsOpen((open) => !open);
              }}
            >
              <FileText size={19} />
              <span>{tr('词')}</span>
            </button>
            <button
              aria-label={tr('音频可视化')}
              aria-pressed={visualization.opened}
              title={
                visualization.opened
                  ? tr('关闭音频可视化')
                  : tr('打开音频可视化（普通小窗口）')
              }
              className={visualization.opened ? 'accent' : ''}
              onClick={visualization.toggle}
            >
              <ChartNoAxesColumnIncreasing size={19} />
              <span>{tr('视')}</span>
            </button>
            <button
              aria-label={tr('待播放列表')}
              onClick={() => {
                setLyricsOpen(false);
                setQueueOpen(true);
              }}
            >
              <ListMusic size={21} />
              <span>{queue.length}</span>
            </button>
          </div>
        </footer>
      </div>
      {lyricsOpen && !modal && (
        <LyricsPanel
          key={current || 'empty'}
          playerHeight={layout.playerHeight}
          track={track}
          positionMs={position * 1000}
          readOnly={readOnly || !ready}
          floating={{
            available: isTauri() || floatingLyrics.available,
            opening: isTauri() ? false : floatingLyrics.opening,
            open: isTauri() ? desktopLyrics.open : !!floatingLyrics.target,
            interactive: isTauri() ? desktopLyrics.interactive : undefined,
            settingsAvailable: !isTauri(),
            error: isTauri() ? desktopLyrics.error : floatingLyrics.error,
            onOpen: () => {
              if (isTauri()) void desktopLyrics.show();
              else void floatingLyrics.open();
            },
            onSettings: () => {
              if (isTauri()) void desktopLyrics.show();
              else void floatingLyrics.open(true);
            },
            onClose: () => {
              if (isTauri()) void desktopLyrics.hide();
              else floatingLyrics.close();
            },
            onToggleInteraction: () => {
              void desktopLyrics.toggleInteraction();
            },
          }}
          onClose={() => setLyricsOpen(false)}
          onSave={(trackId, lyrics) =>
            update((s) => ({
              ...s,
              tracks: s.tracks.map((t) =>
                t.id === trackId ? { ...t, lyrics } : t,
              ),
            }))
          }
        />
      )}
      {organizeLyricsOpen && editingTrack && modal === 'identify' && (
        <LyricsPanel
          key={`organize-${editingTrack.id}`}
          playerHeight={layout.playerHeight}
          track={editingTrack}
          positionMs={editingTrack.id === current ? position * 1000 : 0}
          readOnly={readOnly || !ready}
          floating={{
            available: false,
            opening: false,
            open: false,
            error: '',
            onOpen: () => {},
            onSettings: () => {},
            onClose: () => {},
          }}
          onClose={() => setOrganizeLyricsOpen(false)}
          onSave={(trackId, lyrics) =>
            update((state) => ({
              ...state,
              tracks: state.tracks.map((item) =>
                item.id === trackId ? { ...item, lyrics } : item,
              ),
            }))
          }
        />
      )}
      {floatingLyrics.target && (
        <LyricsWindow
          target={floatingLyrics.target}
          track={track}
          positionMs={position * 1000}
          preferences={lyricsWindowPreferences(state.lyricsWindowPreferences)}
          settingsOpen={floatingLyrics.settingsOpen}
          readOnly={readOnly || !ready}
          playing={playing}
          preparing={preparing}
          canSkip={!!queue.length}
          storageError={tr(storageError)}
          onSettingsChange={floatingLyrics.setSettingsOpen}
          onPreferencesChange={(preferences) =>
            update((s) => ({ ...s, lyricsWindowPreferences: preferences }))
          }
          onTogglePlay={toggle}
          onPrevious={() => next(true)}
          onNext={() => next()}
          onReturn={() => {
            setQueueOpen(false);
            setLyricsOpen(true);
            window.focus();
          }}
          onClose={floatingLyrics.close}
        />
      )}
      <Dialog
        open={
          libraryDialogModes.includes(modal) &&
          !(modal === 'identify' && organizeLyricsOpen)
        }
        onOpenChange={(open) => {
          if (!open)
            setModal((current) =>
              libraryDialogModes.includes(current) ? '' : current,
            );
        }}
      >
        <DialogContent
          className={
            modal === 'info'
              ? 'music-dialog song-details-dialog'
              : 'music-dialog'
          }
        >
          <DialogTitle>
            {
              (
                {
                  new: tr('新建分类'),
                  rename: tr('重命名分类'),
                  assign: tr('添加到分类'),
                  delete: tr('删除分类'),
                  import: tr('导入音乐'),
                  info: tr('播放详情'),
                  folders: tr('音乐文件夹'),
                  relink: tr('重新关联文件夹'),
                  identify: '整理歌曲',
                } as Record<string, string>
              )[modal]
            }
          </DialogTitle>
          <DialogDescription>
            {modal === 'assign'
              ? tr(
                  message('将 {0} 首音乐添加到所选分类，可选择多个。', {
                    0: selected.length,
                  }),
                )
              : modal === 'import'
                ? tr('选择音乐文件或文件夹，原文件不会被修改。')
                : modal === 'delete'
                  ? tr('只删除分类，里面的音乐仍保留在全部音乐中。')
                  : modal === 'folders'
                    ? tr('绑定自己的本地目录，下次自动恢复音乐库。')
                    : modal === 'relink'
                      ? tr('请选择原音乐目录；仅相同相对路径的条目会保留关联。')
                      : modal === 'info'
                        ? tr('查看当前文件的实际播放路径。')
                        : modal === 'identify'
                          ? '集中整理这首歌的分类、资料、封面和歌词。原文件不会改变。'
                          : tr('用你喜欢的方式整理音乐。')}
          </DialogDescription>
          {modal === 'identify' && editingTrack && (
            <div className="identify-panel">
              <strong>{editingTrack.name}</strong>
              <VocalPanel
                vocals={vocals}
                track={editingTrack}
                disabled={!ready || readOnly}
                onCacheCleared={clearVocalSelection}
                onSelect={(version) => {
                  const next = { ...editingTrack, playbackVersion: version };
                  update((s) => ({
                    ...s,
                    tracks: s.tracks.map((item) =>
                      item.id === next.id ? next : item,
                    ),
                  }));
                  if (next.id === current)
                    void player.current
                      ?.load(next, () => resolveAudio(next), position, playing)
                      .catch((error) => setNotice(String(error)));
                }}
              />
              <div className="organize-track-section">
                <h3>{tr('分类')}</h3>
                <div className="organize-track-groups">
                  {groups.map((group) => (
                    <label key={group.id}>
                      <Checkbox
                        checked={editingTrack.groups.includes(group.id)}
                        disabled={readOnly || !ready}
                        onCheckedChange={(checked) =>
                          update((state) => ({
                            ...state,
                            tracks: state.tracks.map((item) =>
                              item.id === editingTrack.id
                                ? {
                                    ...item,
                                    groups: checked
                                      ? [...new Set([...item.groups, group.id])]
                                      : item.groups.filter(
                                          (id) => id !== group.id,
                                        ),
                                  }
                                : item,
                            ),
                          }))
                        }
                      />
                      {group.name}
                    </label>
                  ))}
                  {!groups.length && (
                    <p>{tr('还没有自建分类，可以返回音乐库新建。')}</p>
                  )}
                </div>
              </div>
              <div className="organize-track-section">
                <h3>{tr('封面与歌词')}</h3>
                <div className="organize-track-links">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCoverFromOrganize(true);
                      setModal('cover');
                    }}
                  >
                    {tr('搜索／上传封面')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setOrganizeLyricsOpen(true)}
                  >
                    {tr('搜索／导入歌词及校时')}
                  </Button>
                </div>
              </div>
              <h3>{tr('歌手与专辑资料')}</h3>
              <div className="identify-fields">
                <label>
                  {tr('歌手')}
                  <textarea
                    className="identify-artists-input"
                    value={artistDraft}
                    onChange={(event) => setArtistDraft(event.target.value)}
                    maxLength={500}
                    rows={3}
                    aria-label={tr('每行一位歌手')}
                  />
                </label>
                <label>
                  {tr('专辑')}
                  <Input
                    value={albumDraft}
                    onChange={(event) => setAlbumDraft(event.target.value)}
                    maxLength={200}
                  />
                </label>
                <label>
                  {tr('专辑艺人')}
                  <textarea
                    aria-label={tr('每行一位专辑艺人')}
                    className="identify-artists-input"
                    value={albumArtistDraft}
                    onChange={(event) =>
                      setAlbumArtistDraft(event.target.value)
                    }
                    maxLength={500}
                    rows={2}
                  />
                  <span className="muted">
                    {tr('合辑可填写统一的专辑艺人；留空时按歌曲歌手区分。')}
                  </span>
                </label>
              </div>
              <Button
                disabled={readOnly || !ready}
                onClick={() => {
                  identification.saveManual(
                    editingTrack.id,
                    artistDraft,
                    albumDraft,
                    albumArtistDraft,
                  );
                  setModal('');
                }}
              >
                {tr('保存资料')}
              </Button>
              <Button
                variant="outline"
                disabled={readOnly || !ready}
                onClick={() => identification.retry(editingTrack.id)}
              >
                {tr('重新识别')}
              </Button>
              <Button
                variant="ghost"
                disabled={readOnly || !ready}
                onClick={() => {
                  identification.clear(editingTrack.id);
                  setModal('');
                }}
              >
                {tr('恢复文件标签')}
              </Button>
              {editingTrack.identification?.status === 'failed' && (
                <p>{tr('上次识别未完成，可重新识别；歌曲仍可正常播放。')}</p>
              )}
              <div className="fingerprint-tools">
                <p>
                  {tr(
                    '音频指纹只在你点击下方按钮后生成并发送；不会上传整首音乐。需要免费的 AcoustID Client API key。',
                  )}
                </p>
                <a
                  href="https://acoustid.org/new-application"
                  target="_blank"
                  rel="noreferrer"
                >
                  {tr('申请 AcoustID Client API key')}
                </a>
                <Input
                  type="password"
                  aria-label="AcoustID Client API key"
                  placeholder="AcoustID Client API key"
                  value={acoustIdKeyDraft}
                  onChange={(event) => setAcoustIdKeyDraft(event.target.value)}
                  maxLength={64}
                />
                <Button
                  variant="outline"
                  disabled={
                    identification.fingerprintBusy ||
                    !editingTrack.rootId ||
                    !acoustIdKeyDraft.trim()
                  }
                  onClick={() => {
                    setFingerprintMessage('');
                    void identification
                      .fingerprint(editingTrack, acoustIdKeyDraft.trim())
                      .then((count) =>
                        setFingerprintMessage(
                          count
                            ? tr('找到候选，请在下方确认。')
                            : tr('没有找到指纹匹配结果。'),
                        ),
                      )
                      .catch((error) =>
                        setFingerprintMessage(
                          error instanceof Error
                            ? error.message
                            : tr('指纹识别失败。'),
                        ),
                      );
                  }}
                >
                  {identification.fingerprintBusy
                    ? tr('正在识别…')
                    : tr('使用音频指纹查找')}
                </Button>
                {!editingTrack.rootId && (
                  <small>
                    {tr('请先绑定歌曲所在文件夹，才能使用音频指纹。')}
                  </small>
                )}
                {fingerprintMessage && (
                  <p role="status">{fingerprintMessage}</p>
                )}
              </div>
              {!!editingTrack.identification?.candidates?.length && (
                <div className="identify-candidates">
                  <p>{tr('以下结果需要你确认：')}</p>
                  {editingTrack.identification.candidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      onClick={() => {
                        identification.accept(editingTrack.id, candidate);
                        setModal('');
                      }}
                    >
                      <strong>{candidate.title}</strong>
                      <span>
                        {candidate.artists.join(' / ')} ·{' '}
                        {candidate.album || tr('信息未知')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {(modal === 'new' || modal === 'rename') && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveGroup();
              }}
            >
              <Input
                aria-label={tr('分类名称')}
                autoFocus
                maxLength={32}
                placeholder={tr('例如：深夜听的歌')}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                className="dialog-submit"
                disabled={!name.trim()}
                type="submit"
              >
                {modal === 'rename' ? tr('保存名称') : tr('创建分类')}
              </Button>
            </form>
          )}
          {modal === 'assign' && (
            <>
              <div className="assign-list">
                {groups.map((g) => (
                  <label key={g.id}>
                    <Checkbox
                      checked={targets.includes(g.id)}
                      onCheckedChange={(c) =>
                        setTargets((a) =>
                          c ? [...a, g.id] : a.filter((x) => x !== g.id),
                        )
                      }
                    />
                    {g.name}
                  </label>
                ))}
              </div>
              {!groups.length && <p>{tr('请先创建一个分类。')}</p>}
              <Button disabled={!targets.length} onClick={assign}>
                {tr('添加到所选分类')}
              </Button>
            </>
          )}
          {modal === 'import' && (
            <>
              {canBindDirectory() && (
                <button
                  className="import-choice"
                  disabled={!!busy || !ready || readOnly}
                  onClick={() => {
                    setModal('folders');
                    void library.bind();
                  }}
                >
                  <Folder />
                  <div>
                    <strong>{tr('绑定音乐文件夹 · 推荐')}</strong>
                    <span>{tr('保存目录访问，下次恢复音乐库')}</span>
                  </div>
                  <Plus />
                </button>
              )}
              <button
                className="import-choice"
                disabled={!ready || readOnly}
                onClick={() => fileInput.current?.click()}
              >
                <Music2 />
                <div>
                  <strong>{tr('临时选择音乐文件')}</strong>
                  <span>{tr('适合试听；刷新后需要重新选择')}</span>
                </div>
                <Plus />
              </button>
              {!canBindDirectory() && (
                <button
                  className="import-choice"
                  onClick={() => folderInput.current?.click()}
                >
                  <Folder />
                  <div>
                    <strong>{tr('临时选择文件夹')}</strong>
                    <span>{tr('当前浏览器不支持长期绑定')}</span>
                  </div>
                  <Plus />
                </button>
              )}
              <p className="muted">
                {isDesktopApp()
                  ? tr(
                      '桌面版通过系统选择的文件夹读取音乐，不上传或修改原文件。扩展解码首次使用需要下载约 32 MB 解码资源。',
                    )
                  : tr(
                      '推荐桌面 Chrome / Edge。文件不会上传。扩展解码首次使用需要下载约 32 MB 解码资源；支持情况以实际文件为准。',
                    )}
              </p>
            </>
          )}
          {modal === 'folders' && (
            <>
              <div className="roots-list">
                {state.roots.map((root) => (
                  <div key={root.id} className="root-item">
                    <strong>
                      <Folder size={16} />
                      {root.name}
                    </strong>
                    <p className="muted">
                      {library.permissions[root.id] === 'granted'
                        ? tr('已授权读取')
                        : library.permissions[root.id] === 'unavailable'
                          ? tr('目录暂不可用')
                          : tr('需要重新授权')}{' '}
                      ·{' '}
                      {
                        tracks.filter((t) => t.rootId === root.id && !t.missing)
                          .length
                      }{' '}
                      {tr('首可播放')}
                      {tracks.some((t) => t.rootId === root.id && t.missing)
                        ? ` · ${tracks.filter((t) => t.rootId === root.id && t.missing).length} ${tr('首暂不可用')}`
                        : ''}
                    </p>
                    <div className="root-actions">
                      {library.permissions[root.id] === 'granted' ? (
                        <Button
                          variant="outline"
                          disabled={!!busy || readOnly}
                          onClick={() => library.rescan(root)}
                        >
                          {tr('刷新音乐库')}
                        </Button>
                      ) : (
                        <Button
                          disabled={
                            !!busy ||
                            readOnly ||
                            (!root.handle && !root.nativePath)
                          }
                          onClick={() =>
                            root.nativePath
                              ? void library.bind(root.id)
                              : library.authorize(root)
                          }
                        >
                          {root.nativePath
                            ? tr('重新选择文件夹')
                            : tr('重新授权')}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        disabled={!!busy || readOnly || !canBindDirectory()}
                        onClick={() => {
                          setRelinkId(root.id);
                          setModal('relink');
                        }}
                      >
                        {tr('重新关联')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              {!state.roots.length && (
                <p className="muted">
                  {tr('尚未绑定目录。首次选择后，音乐文件仍保留在原位置。')}
                </p>
              )}
              <Button
                disabled={!canBindDirectory() || !!busy || !ready || readOnly}
                onClick={() => library.bind()}
              >
                <FolderPlus size={16} />
                {tr('添加音乐文件夹')}
              </Button>
              <p className="muted">
                {isDesktopApp()
                  ? tr(
                      '在系统窗口中单击要绑定的文件夹，再点“打开”；双击文件夹会进入其中。绑定后会扫描支持的音乐文件，不会移动或上传原文件。',
                    )
                  : tr(
                      '权限由浏览器管理。换设备、清除网站数据或移动目录后可能需要恢复访问。',
                    )}
                {!canBindDirectory() &&
                  tr('请在桌面 Chrome / Edge 中打开以使用目录绑定。')}
              </p>
              {notice && (
                <p
                  className="muted"
                  role="alert"
                  style={{ color: 'var(--destructive)' }}
                >
                  {tr(notice)}
                </p>
              )}
            </>
          )}
          {modal === 'relink' && (
            <>
              <p className="muted">
                {tr(
                  '如果选择了另一个目录，不同文件可能拥有相同相对路径。请确认它确实是原音乐目录，文件名相同并不代表内容相同。',
                )}
              </p>
              <Button
                onClick={() => {
                  setModal('folders');
                  void library.bind(relinkId);
                }}
              >
                {tr('选择并关联原目录')}
              </Button>
            </>
          )}
          {modal === 'info' && (
            <div className="info-copy">
              <SongDetails key={track?.id} track={track} {...songInfo} />
              {isTauri() && track && (
                <VocalPanel
                  vocals={vocals}
                  track={track}
                  disabled={!ready || readOnly}
                  onCacheCleared={clearVocalSelection}
                  onSelect={(version) => {
                    const next = { ...track, playbackVersion: version };
                    update((s) => ({
                      ...s,
                      tracks: s.tracks.map((item) =>
                        item.id === next.id ? next : item,
                      ),
                    }));
                    void player.current
                      ?.load(next, () => resolveAudio(next), position, playing)
                      .catch((error) => setNotice(String(error)));
                  }}
                />
              )}
              <h3>{tr('当前播放处理')}</h3>
              <p>
                {tr('播放路径：')}
                {ps.path ? tr(ps.path) : tr('尚未开始播放')}
              </p>
              {ps.info && (
                <p>
                  {tr('编码：')}
                  {ps.info.codec} · {ps.info.channels} {tr('声道')}
                  <br />
                  {tr('源采样率：')}
                  {localizedNumber(ps.info.sampleRate)} Hz
                  <br />
                  {tr('浏览器处理采样率：')}
                  {ps.outputRate
                    ? localizedNumber(ps.outputRate)
                    : tr('未知')}{' '}
                  Hz
                </p>
              )}
              {!ps.info && ps.outputRate && (
                <p>
                  {tr('浏览器处理采样率：')}
                  {localizedNumber(ps.outputRate)} Hz
                </p>
              )}
              {ps.startupMs !== undefined && (
                <p>
                  {tr('准备耗时：')}
                  {(ps.startupMs / 1000).toFixed(2)} {tr('秒')}
                </p>
              )}
              {ps.decodedSeconds !== undefined && (
                <p>
                  {tr('已解码：')}
                  {ps.decodedSeconds.toFixed(1)} {tr('秒 · 解码计算耗时：')}
                  {((ps.decodeMs || 0) / 1000).toFixed(2)} {tr('秒')}
                  <br />
                  {tr('缓冲：')}
                  {(ps.bufferSeconds || 0).toFixed(1)} {tr('秒')}
                </p>
              )}
              <p>
                {tr(
                  '扩展解码采用分段 PCM 缓冲，不生成整首 WAV。DSD 会转换为 PCM；浏览器和系统可能重采样，未验证设备无损直出。',
                )}
              </p>
              <p className="muted">
                {tr('开源解码组件：FFmpeg WASM（GPL-2.0-or-later）。')}
                <a href={publicAssetPath('/decoder/NOTICE.txt')} target="_blank" rel="noreferrer">
                  {tr('组件与来源说明')}
                </a>
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <input
        ref={fileInput}
        disabled={!ready || readOnly}
        type="file"
        multiple
        hidden
        accept="audio/*,.dsf,.dff,.flac,.ape,.wma"
        onChange={(e) => {
          importFiles(Array.from(e.target.files || []));
          e.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        disabled={!ready || readOnly}
        type="file"
        multiple
        hidden
        {...({ webkitdirectory: '' } as object)}
        onChange={(e) => {
          importFiles(Array.from(e.target.files || []));
          e.target.value = '';
        }}
      />
      {notice && (
        <div role="status" className="notice">
          {tr(notice)}
          <button aria-label={tr('关闭提示')} onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
      <AlertDialog
        open={modal === 'clear-temporary'}
        onOpenChange={(open) => {
          if (!open) setModal('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{tr('清除临时音乐')}？</AlertDialogTitle>
          <AlertDialogDescription>
            {tr('将从音乐库和播放队列移除')} {temporaryCount}{' '}
            {tr('首临时导入的歌曲。Mac 上的原文件不会删除。')}
          </AlertDialogDescription>
          <Button
            variant="destructive"
            disabled={!ready || readOnly || !temporaryCount}
            onClick={() => {
              if (track && !track.rootId && !track.catalog)
                player.current?.stop();
              const count = library.clearTemporary();
              setSelected([]);
              setModal('');
              notify(
                message('{0} 首临时音乐已清除，原文件保留。', { 0: count }),
              );
            }}
          >
            {tr('确认清除')}
          </Button>
          <AlertDialogCancel>{tr('取消')}</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={modal === 'delete'}
        onOpenChange={(open) => {
          if (!open) setModal('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {tr('删除「')}
            {title}」？
          </AlertDialogTitle>
          <AlertDialogDescription>
            {tr('音乐保留在全部音乐中，原文件不会被修改。')}
          </AlertDialogDescription>
          <Button
            variant="destructive"
            onClick={() => {
              update((s) => ({
                ...s,
                groups: s.groups.filter((g) => g.id !== view),
                tracks: s.tracks.map((t) => ({
                  ...t,
                  groups: t.groups.filter((g) => g !== view),
                })),
              }));
              setView('all');
              setModal('');
            }}
          >
            {tr('删除分类')}
          </Button>
          <AlertDialogCancel>{tr('取消')}</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={modal === 'remove-selected'}
        onOpenChange={(open) => {
          if (!open) setModal('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {tr(message('移除选中的 {0} 首歌曲？', {0:selected.length}))}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {tr('歌曲会从播放器音乐库和队列中移除，Mac 上的原文件保留。')}
          </AlertDialogDescription>
          <Button
            variant="destructive"
            disabled={readOnly || !ready}
            onClick={() => {
              if (current && selected.includes(current)) player.current?.stop();
              library.removeMany(selected);
              setSelected([]);
              setModal('');
              notify('已从音乐库移除，原文件保留。');
            }}
          >
            {tr('确认移除')}
          </Button>
          <AlertDialogCancel>{tr('取消')}</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={modal === 'remove-track'}
        onOpenChange={(open) => {
          if (!open) setModal('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{tr('移除这首音乐？')}</AlertDialogTitle>
          <AlertDialogDescription>
            「{tracks.find((t) => t.id === removeId)?.name}
            {tr(
              '」将从音乐库、所有分类和播放队列中移除。电脑里的原文件保留，刷新文件夹不会自动加回。',
            )}
            {current === removeId ? tr('当前播放会停止。') : ''}
          </AlertDialogDescription>
          <Button
            variant="destructive"
            disabled={readOnly || !ready}
            onClick={() => {
              if (current === removeId) player.current?.stop();
              library.remove(removeId);
              setSelected((ids) => ids.filter((id) => id !== removeId));
              setModal('');
              setRemoveId('');
              notify('已从音乐库移除，原文件保留。');
            }}
          >
            {tr('确认移除')}
          </Button>
          <AlertDialogCancel>{tr('取消')}</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
