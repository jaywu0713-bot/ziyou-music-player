'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, PhysicalPosition } from '@tauri-apps/api/window';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { listen } from '@tauri-apps/api/event';
import { DESKTOP_LYRICS_HIDDEN_EVENT, DESKTOP_LYRICS_LABEL, DESKTOP_LYRICS_NEXT_LABEL, DESKTOP_LYRICS_SHORTCUT } from '@/lib/desktop/window';
import type { LyricPart } from '@/lib/desktop/lyrics-state';
import { visibleLyricPosition } from '@/lib/desktop/lyrics-state';

const label = (part: LyricPart) => part === 'current' ? DESKTOP_LYRICS_LABEL : DESKTOP_LYRICS_NEXT_LABEL;
const getWindow = (part: LyricPart) => WebviewWindow.getByLabel(label(part));

export function useDesktopLyricsWindow() {
  const [shown, setShown] = useState({current:false,next:false});
  const [interactiveState, setInteractive] = useState(false);
  const [error, setError] = useState('');
  const interactiveRef = useRef(false);

  const showPart = useCallback(async (part: LyricPart) => {
    const window = await getWindow(part);
    if (!window) throw new Error('歌词窗口尚未就绪，请重启播放器后重试。');
    await window.setIgnoreCursorEvents(!interactiveRef.current);
    await window.setAlwaysOnTop(true);
    await window.show();
    setShown((old)=>({...old,[part]:true}));
    setError('');
  }, []);
  const hidePart = useCallback(async (part: LyricPart) => {
    const window = await getWindow(part);
    if (window) await window.hide();
    setShown((old)=>({...old,[part]:false}));
  }, []);
  const setInteraction = useCallback(async (enabled: boolean) => {
    interactiveRef.current = enabled;
    await Promise.all((['current','next'] as const).map(async (part) => {
      const window=await getWindow(part);
      if (window) await window.setIgnoreCursorEvents(!enabled);
    }));
    setInteractive(enabled);
  }, []);
  const toggleInteraction = useCallback(() => setInteraction(!interactiveRef.current), [setInteraction]);
  const show = useCallback(async () => {
    interactiveRef.current=false;
    setInteractive(false);
    await Promise.all([showPart('current'),showPart('next')]);
  }, [showPart]);
  const hide = useCallback(async () => { await Promise.all([hidePart('current'),hidePart('next')]); }, [hidePart]);
  const resetPositions = useCallback(async () => {
    localStorage.removeItem('ziyou.desktop-lyrics-position');
    localStorage.removeItem('ziyou.desktop-lyrics-next-position');
    const monitors=await availableMonitors();
    await Promise.all((['current','next'] as const).map(async (part) => {
      const window=await getWindow(part);
      if (window) {
        const position=visibleLyricPosition(null,await window.outerSize(),monitors);
        await window.setPosition(new PhysicalPosition(position.x,position.y+(part==='next'?100:0)));
      }
    }));
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let registered = false;
    let unlistenHidden: (() => void) | undefined;
    void (async () => {
      unlistenHidden = await listen<LyricPart>(DESKTOP_LYRICS_HIDDEN_EVENT, (event) => {
        const part = event.payload === 'next' ? 'next' : 'current';
        setShown((old)=>({...old,[part]:false}));
      });
      await register(DESKTOP_LYRICS_SHORTCUT, async (event) => {
        if (event.state !== 'Pressed' || !alive) return;
        const windows=await Promise.all((['current','next'] as const).map(getWindow));
        const visible=await Promise.all(windows.map((window)=>window?.isVisible() || Promise.resolve(false)));
        if (!visible.some(Boolean)) {
          await setInteraction(true);
          await Promise.all([showPart('current'),showPart('next')]);
        } else await setInteraction(!interactiveRef.current);
      });
      registered = true;
      if (!alive) { await unregister(DESKTOP_LYRICS_SHORTCUT); unlistenHidden?.(); }
    })().catch((cause: unknown) => {
      if (alive) setError(cause instanceof Error ? cause.message : '无法注册歌词窗口快捷键。');
    });
    return () => {
      alive = false;
      unlistenHidden?.();
      if (registered) void unregister(DESKTOP_LYRICS_SHORTCUT).catch(() => {});
    };
  }, [setInteraction,showPart]);

  const openWindow = useCallback(() => {
    if (!isTauri()) return Promise.resolve();
    return show().catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : '无法打开歌词窗口。'); });
  }, [show]);

  return { open: shown.current || shown.next, shown, interactive: interactiveState, error, show: openWindow, hide, showPart, hidePart, resetPositions, toggleInteraction };
}
