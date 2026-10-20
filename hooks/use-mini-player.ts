import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  MINI_ACTION,
  MINI_STATE,
  MINI_COVER,
  MINI_HIDDEN,
  MINI_REQUEST,
  MiniWindowController,
  parseMiniAction,
  type MiniSnapshot,
  type MiniAction,
  type MiniMode,
  type MiniPreferences,
} from '@/lib/desktop/mini-player';

async function thumbnail(url: string) {
  if (!url) return '';
  if (url.startsWith('https://')) return url;
  if (!url.startsWith('blob:')) return '';
  const response = await fetch(url);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas
      .getContext('2d')
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    bitmap.close();
  }
}
export function useMiniPlayer(
  snapshot: MiniSnapshot,
  coverUrl: string,
  execute: (action: Exclude<MiniAction, { type: 'mode' }>) => void,
  notify: (message: string) => void,
) {
  const [opened, setOpened] = useState(false);
  const live = useRef({ snapshot, execute, notify });
  useEffect(() => {
    live.current = { snapshot, execute, notify };
  }, [snapshot, execute, notify]);
  const cover = useRef({ trackId: snapshot.trackId, url: '' });
  const controller = useRef<MiniWindowController | null>(null);
  const alive = useRef(false);
  const report = (error: unknown) =>
    live.current.notify(`迷你播放器：${String(error)}`);
  const push = () => emitTo('mini', MINI_STATE, live.current.snapshot);
  async function changeMode(mode: MiniMode) {
    if (!controller.current) throw new Error('窗口正在准备，请稍后再试。');
    await controller.current.open(mode);
    if (alive.current) setOpened(true);
    await push();
    await emitTo('mini', MINI_COVER, cover.current);
    await emitTo(
      'mini',
      'ziyou:mini-preferences',
      await invoke<MiniPreferences>('mini_preferences'),
    );
  }
  useEffect(() => {
    if (!isTauri()) return;
    alive.current = true;
    let disposed = false;
    const stops: Array<() => void> = [];
    async function subscribe(
      event: string,
      callback: (payload: unknown) => void,
    ) {
      const stop = await listen(event, ({ payload }) => {
        if (!disposed) callback(payload);
      });
      if (disposed) stop();
      else stops.push(stop);
    }
    void (async () => {
      const main = await WebviewWindow.getByLabel('main'),
        mini = await WebviewWindow.getByLabel('mini');
      if (disposed) return;
      if (!main || !mini) throw new Error('迷你播放器窗口不存在，请重启软件。');
      controller.current = new MiniWindowController({
        showMini: async () => {
          const preferences = await invoke<MiniPreferences>('mini_prepare');
          await emitTo('mini', 'ziyou:mini-preferences', preferences);
          await mini.show();
        },
        focusMini: () => mini.setFocus(),
        hideMain: () => main.hide(),
        showMain: () => main.show(),
        restore: () => invoke('mini_restore_main'),
        saveMode: async (mode) => {
          await invoke('mini_save_preferences', { mode, pinned: null });
        },
      });
      await subscribe(MINI_ACTION, (payload) => {
        const action = parseMiniAction(payload);
        if (!action) return;
        if (action.type === 'mode') void changeMode(action.value).catch(report);
        else live.current.execute(action);
      });
      await subscribe(MINI_HIDDEN, () => setOpened(false));
      await subscribe(MINI_REQUEST, () => {
        void push().catch(report);
        void emitTo('mini', MINI_COVER, cover.current).catch(report);
      });
    })().catch((error) => {
      if (!disposed) report(error);
    });
    return () => {
      disposed = true;
      alive.current = false;
      controller.current = null;
      stops.forEach((stop) => stop());
    };
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const trackId = snapshot.trackId;
    cover.current = { trackId, url: '' };
    void thumbnail(coverUrl)
      .catch(() => '')
      .then((url) => {
        if (disposed) return;
        cover.current = { trackId, url };
        void emitTo('mini', MINI_COVER, cover.current).catch(report);
      });
    return () => {
      disposed = true;
    };
  }, [coverUrl, snapshot.trackId]);
  useEffect(() => {
    if (!isTauri() || !opened) return;
    const timer = setInterval(() => void push().catch(report), 250);
    return () => clearInterval(timer);
  }, [opened]);
  async function toggle() {
    try {
      if (opened) {
        await controller.current?.restore();
        setOpened(false);
      } else {
        const prefs = await invoke<MiniPreferences>('mini_preferences');
        await changeMode(prefs.mode);
      }
    } catch (error) {
      report(error);
    }
  }
  return { opened, toggle };
}
