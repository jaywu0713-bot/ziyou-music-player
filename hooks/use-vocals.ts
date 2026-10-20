import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Root, Track } from '@/lib/music/model';
import type { VocalStatus } from '@/lib/desktop/vocals';

export function useVocals(
  roots: Root[],
  resolveOriginal: (track: Track) => Promise<File>,
  notify: (message: string) => void,
) {
  const [status, setStatus] = useState<VocalStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const cancelled = useRef(false);
  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const next = await invoke<VocalStatus>('vocal_status');
      if (mounted.current) setStatus(next);
    } catch (cause) {
      if (mounted.current) setError(String(cause));
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (!isTauri()) return;
    void Promise.resolve().then(refresh);
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function action(work: () => Promise<void>) {
    if (busy) return false;
    cancelled.current = false;
    setBusy(true);
    setError('');
    try {
      await work();
      return true;
    } catch (cause) {
      if (!cancelled.current && mounted.current) {
        setError(String(cause));
        notify(String(cause));
      }
      return false;
    } finally {
      if (mounted.current) {
        setBusy(false);
        await refresh();
      }
    }
  }
  async function generate(track: Track) {
    await action(async () => {
      const root = roots.find((root) => root.id === track.rootId);
      const file = root?.nativePath ? null : await resolveOriginal(track);
      const id = await invoke<string>('vocal_begin', {
        trackId: track.id,
        name: track.name,
        size: file?.size ?? track.size ?? 0,
        modified: file?.lastModified ?? track.modified ?? 0,
        rootPath: root?.nativePath ?? null,
        relativePath: root?.nativePath ? (track.path ?? null) : null,
      });
      try {
        if (file)
          for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
            if (cancelled.current) throw new Error('已取消处理。');
            const bytes = new Uint8Array(
              await file.slice(offset, offset + 1024 * 1024).arrayBuffer(),
            );
            await invoke('vocal_upload', { id, bytes: Array.from(bytes) });
          }
        await refresh();
        if (cancelled.current) throw new Error('已取消处理。');
        await invoke('vocal_run', { id });
        notify('伴奏已生成并缓存。可选择“伴奏”播放，也可随时清除。');
      } catch (error) {
        await invoke('vocal_cancel').catch(() => {});
        throw error;
      }
    });
  }
  async function cancel() {
    cancelled.current = true;
    await invoke('vocal_cancel');
    await refresh();
  }
  const download = () =>
    action(async () => {
      await invoke('vocal_download');
      notify('本地模型已下载并校验，今后可离线生成伴奏。');
    });
  const clear = (key: string | null, model = false) =>
    action(async () => {
      await invoke('vocal_clear', { key, model });
      notify(
        model
          ? '模型已删除，已生成的伴奏仍保留。'
          : '伴奏缓存已清除，原音乐文件保留。',
      );
    });
  return {
    status,
    error,
    busy: busy || !!status?.job,
    generate,
    cancel,
    download,
    clear,
    refresh,
  };
}
