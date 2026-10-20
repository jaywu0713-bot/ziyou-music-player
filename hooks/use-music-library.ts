'use client';
import { languageOf, message, setLanguage } from '@/lib/i18n/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  emptyLibrary,
  applySuccessfulRootScan,
  migrateLegacy,
  removeTrack,
  removeTemporaryTracks,
  reconcilePlayOrder,
  supportedExtension,
  type LibraryState,
  type Root,
  type Track,
} from '@/lib/music/model';
import {
  readLibrary,
  writeLibrary,
  deleteTrackCovers,
} from '@/lib/music/storage';
import {
  directoryPermission,
  pickDirectory,
  resolveTrackFile,
  scanDirectory,
  isDesktopApp,
} from '@/lib/music/files';
import {
  desktopFolderPermission,
  pickDesktopFolder,
  scanDesktopFolder,
} from '@/lib/desktop/folders';

export function useMusicLibrary(notify: (message: string) => void) {
  const [state, setState] = useState<LibraryState>(emptyLibrary);
  const [ready, setReady] = useState(false),
    [readOnly, setReadOnly] = useState(false);
  const [storageError, setStorageError] = useState(''),
    [busy, setBusy] = useState('');
  const [permissions, setPermissions] = useState<Record<string, string>>({});
  const stateRef = useRef(state),
    notifyRef = useRef(notify),
    temporary = useRef(new Map<string, File>());
  const scan = useRef<AbortController | null>(null),
    saving = useRef(Promise.resolve()),
    readyRef = useRef(false);
  notifyRef.current = notify;
  const update = useCallback((fn: (s: LibraryState) => LibraryState) => {
    if (!readyRef.current) return;
    const next = fn(stateRef.current);
    stateRef.current = next;
    setState(next);
    // Persist each deliberate edit immediately, keeping ordering across async DB opens.
    saving.current = saving.current
      .then(() => writeLibrary(next))
      .then(() => setStorageError(''))
      .catch(() =>
        setStorageError(
          '保存失败：当前更改尚未写入浏览器。请保留页面并释放存储空间后重试。',
        ),
      );
  }, []);
  useEffect(() => {
    let alive = true;
    let release: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function initialize(writable: boolean) {
      try {
        const saved = await readLibrary();
        const loaded =
          saved || migrateLegacy(localStorage.getItem('music-demo-v1'));
        if (loaded.version !== 2)
          throw new Error('音乐库版本不兼容，请保留浏览器数据。');
        const next = isDesktopApp() && loaded.mode === 1 && !loaded.playOrder
          ? { ...loaded, playOrder: reconcilePlayOrder(loaded.queue, undefined, loaded.currentEntry) }
          : loaded;
        if ((!saved || next !== loaded) && writable) await writeLibrary(next);
        if (!alive) return;
        setLanguage(languageOf(next.personalPreferences?.language));
        stateRef.current = next;
        setState(next);
        setReadOnly(!writable);
        readyRef.current = writable;
        setReady(true);
        const status: Record<string, string> = {};
        for (const root of next.roots) {
          try {
            status[root.id] = root.nativePath
              ? await desktopFolderPermission({ path: root.nativePath, name: root.name })
              : root.handle
                ? await directoryPermission(root.handle)
                : 'unlinked';
          } catch {
            status[root.id] = 'unavailable';
          }
        }
        if (alive) setPermissions(status);
      } catch (e) {
        if (alive) {
          setStorageError(
            e instanceof Error
              ? e.message
              : '无法打开本地音乐库，请检查浏览器存储设置后重新加载。',
          );
          setReadOnly(true);
          setReady(true);
        }
      }
    }
    if (navigator.locks) {
      void navigator.locks.request(
        'ziyou-library-editor',
        { ifAvailable: true },
        async (lock) => {
          if (!alive) return;
          await initialize(!!lock);
          if (lock) await hold;
        },
      );
    } else void initialize(true);
    return () => {
      alive = false;
      readyRef.current = false;
      release?.();
      scan.current?.abort();
    };
  }, []);
  const resolveFile = useCallback(
    (t: Track) =>
      resolveTrackFile(t, stateRef.current.roots, temporary.current),
    [],
  );
  async function rescan(root: Root) {
    if ((!root.handle && !root.nativePath) || scan.current || !readyRef.current) return;
    const controller = new AbortController();
    scan.current = controller;
    setBusy(message("扫描 {0}…", {0:root.name}));
    try {
      const permission = root.nativePath
        ? await desktopFolderPermission({ path: root.nativePath, name: root.name })
        : await directoryPermission(root.handle!);
      if (permission !== 'granted') {
        setPermissions((p) => ({ ...p, [root.id]: 'prompt' }));
        throw new Error('请先重新授权目录，再刷新音乐库。');
      }
      const files = root.nativePath
        ? await scanDesktopFolder(
            { path: root.nativePath, name: root.name },
            controller.signal,
            (n) => setBusy(message("扫描 {0} · 已找到 {1} 首", {0:root.name,1:n})),
          )
        : await scanDirectory(root.handle!, controller.signal, (n) =>
        setBusy(message("扫描 {0} · 已找到 {1} 首", {0:root.name,1:n})),
      );
      update((s) => applySuccessfulRootScan(s, root, files));
      setPermissions((p) => ({ ...p, [root.id]: 'granted' }));
      notifyRef.current(
        message("已刷新「{0}」，找到 {1} 首音乐。", {0:root.name,1:files.length}),
      );
    } catch (e) {
      if (!controller.signal.aborted)
        notifyRef.current(
          e instanceof Error ? e.message : '扫描失败。已有音乐与分类保持不变。',
        );
    } finally {
      scan.current = null;
      setBusy('');
    }
  }
  async function bind(replaceId?: string) {
    if (!readyRef.current || scan.current) return;
    try {
      if (isDesktopApp()) {
        const folder = await pickDesktopFolder();
        if (!folder) return;
        if (
          stateRef.current.roots.some(
            (existing) =>
              existing.id !== replaceId && existing.nativePath === folder.path,
          )
        ) {
          notifyRef.current('这个音乐文件夹已经绑定。');
          return;
        }
        const root: Root = {
          id: replaceId || crypto.randomUUID(),
          name: folder.name,
          nativePath: folder.path,
        };
        await rescan(root);
        return;
      }
      const handle = await pickDirectory();
      for (const existing of stateRef.current.roots) {
        if (
          existing.id !== replaceId &&
          existing.handle &&
          (await handle.isSameEntry(existing.handle).catch(() => false))
        ) {
          notifyRef.current('这个音乐文件夹已经绑定。');
          return;
        }
      }
      const root: Root = {
        id: replaceId || crypto.randomUUID(),
        name: handle.name,
        handle,
      };
      await rescan(root);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        notifyRef.current(
          e instanceof Error
            ? e.message
            : isDesktopApp()
              ? `绑定目录失败：${String(e)}`
              : '无法绑定目录。请在独立浏览器窗口打开。',
        );
    }
  }
  async function authorize(root: Root) {
    if ((!root.handle && !root.nativePath) || !readyRef.current || scan.current) return;
    try {
      const status = root.nativePath
        ? await desktopFolderPermission({ path: root.nativePath, name: root.name })
        : await directoryPermission(root.handle!, true);
      setPermissions((p) => ({ ...p, [root.id]: status }));
      if (status === 'granted') await rescan(root);
      else notifyRef.current('尚未获得读取权限，分类继续保留。');
    } catch {
      notifyRef.current('无法恢复原目录访问，请选择“重新关联”。');
    }
  }
  function importFiles(files: File[]) {
    if (!readyRef.current) return;
    let count = 0;
    let restored = 0;
    update((s) => {
      const tracks = [...s.tracks];
      for (const file of files) {
        if (!supportedExtension(file.name)) continue;
        const key = `${file.webkitRelativePath || file.name}|${file.size}|${file.lastModified}`;
        const old = tracks.find((t) => !t.rootId && t.key === key);
        const id = old?.id || crypto.randomUUID();
        temporary.current.set(id, file);
        if (old) restored++;
        else {
          tracks.push({
            id,
            key,
            name: file.name,
            size: file.size,
            modified: file.lastModified,
            format: file.name.split('.').pop()!.toUpperCase(),
            duration: 0,
            groups: [],
          });
          count++;
        }
      }
      return { ...s, tracks };
    });
    notifyRef.current(
      count || restored
        ? message("添加 {0} 首，恢复 {1} 首。临时文件刷新后需重新选择；建议绑定文件夹。", {0:count,1:restored})
        : '没有找到可识别的音乐文件。',
    );
  }
  return {
    state,
    trackById: (id: string) => stateRef.current.tracks.find((track) => track.id === id),
    update,
    ready,
    readOnly,
    storageError,
    busy,
    permissions,
    resolveFile,
    bind,
    rescan,
    authorize,
    importFiles,
    remove: (id: string) => {
      temporary.current.delete(id);
      update((s) => removeTrack(s, id));
      void deleteTrackCovers(id).catch(() =>
        notifyRef.current('歌曲已移除，但封面缓存清理失败。'),
      );
    },
    removeMany: (ids: string[]) => {
      const unique=[...new Set(ids)];
      for(const id of unique) temporary.current.delete(id);
      update((state)=>unique.reduce((current,id)=>removeTrack(current,id),state));
      void Promise.allSettled(unique.map((id)=>deleteTrackCovers(id))).then((results)=>{
        if(results.some((result)=>result.status==='rejected')) notifyRef.current('歌曲已移除，但部分封面缓存清理失败。');
      });
    },
    clearTemporary: () => {
      const ids = stateRef.current.tracks.filter((track) => !track.rootId && !track.catalog).map((track) => track.id);
      for (const id of ids) temporary.current.delete(id);
      update((s) => removeTemporaryTracks(s));
      void Promise.allSettled(ids.map((id) => deleteTrackCovers(id))).then((results) => {
        if (results.some((result) => result.status === 'rejected')) notifyRef.current('临时音乐已移除，但部分缓存清理失败。');
      });
      return ids.length;
    },
    cancelScan: () => scan.current?.abort(),
    retrySave: () => update((s) => ({ ...s })),
  };
}
