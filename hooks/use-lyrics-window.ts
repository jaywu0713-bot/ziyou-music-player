'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

type DocumentPiP = {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
};
type PiPWindow = Window & { documentPictureInPicture?: DocumentPiP };
const subscribeToCapability = () => () => {};
const supportsLyricsWindow = () => window.isSecureContext && window.top === window &&
  typeof (window as PiPWindow).documentPictureInPicture?.requestWindow === 'function';
const serverCapability = () => false;

export function useLyricsWindow() {
  const available = useSyncExternalStore(subscribeToCapability, supportsLyricsWindow, serverCapability);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const child = useRef<Window | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    const close = () => { generation.current++; child.current?.close(); child.current = null; };
    const leavePage = () => {
      close();
      setTarget(null);
      setSettingsOpen(false);
      setOpening(false);
    };
    window.addEventListener('pagehide', leavePage);
    return () => { window.removeEventListener('pagehide', leavePage); close(); };
  }, []);

  const showPreferences = useCallback((value: boolean) => {
    setSettingsOpen(value);
    if (value && child.current && !child.current.closed) {
      try { child.current.resizeTo(child.current.outerWidth, Math.max(child.current.outerHeight, 440)); }
      catch { /* Resizing is a browser-controlled hint; the content remains scrollable. */ }
    }
  }, []);

  const open = useCallback(async (showSettings = false) => {
    const existing = child.current;
    if (existing && !existing.closed) {
      showPreferences(showSettings);
      existing.focus();
      return;
    }
    if (pending.current) return;
    const api = (window as PiPWindow).documentPictureInPicture;
    if (!window.isSecureContext || window.top !== window || !api?.requestWindow) {
      setError('此浏览器不支持歌词小窗口。请用桌面 Chrome 或 Edge 单独打开播放器，页面内歌词仍可使用。');
      return;
    }
    const id = ++generation.current;
    pending.current = true;
    setOpening(true);
    setError('');
    let opened: Window | null = null;
    try {
      // Request inside the click handler, before any asynchronous work consumes activation.
      opened = await api.requestWindow({ width: 480, height: showSettings ? 440 : 260 });
      if (id !== generation.current) { opened.close(); return; }
      const doc = opened.document;
      doc.title = '自用 · 悬浮歌词';
      doc.documentElement.lang = 'zh-CN';
      doc.documentElement.className = document.documentElement.className;
      // React portals share state, but the new document needs its own styles.
      for (const source of document.querySelectorAll('style, link[rel="stylesheet"]')) {
        const copy = source.cloneNode(true) as HTMLElement;
        if (source instanceof HTMLLinkElement) (copy as HTMLLinkElement).href = source.href;
        doc.head.appendChild(copy);
      }
      doc.body.className = 'lyrics-window-body';
      const mount = doc.createElement('div');
      mount.id = 'ziyou-lyrics-window';
      doc.body.appendChild(mount);
      child.current = opened;
      opened.addEventListener('pagehide', () => {
        if (id !== generation.current) return;
        child.current = null;
        setTarget(null);
        setSettingsOpen(false);
      }, { once: true });
      setSettingsOpen(showSettings);
      setTarget(mount);
    } catch (cause) {
      opened?.close();
      if (id !== generation.current) return;
      const denied = cause instanceof DOMException && cause.name === 'NotAllowedError';
      setError(denied
        ? '浏览器暂未允许打开小窗口，请直接点击“悬浮歌词”重试。'
        : '无法打开歌词小窗口，请在桌面 Chrome 或 Edge 中重试。页面内歌词仍可使用。');
    } finally {
      pending.current = false;
      if (id === generation.current) setOpening(false);
    }
  }, [showPreferences]);

  const close = useCallback(() => {
    generation.current++;
    child.current?.close();
    child.current = null;
    setTarget(null);
    setOpening(false);
    setSettingsOpen(false);
  }, []);

  return { available, opening, error, target, settingsOpen, setSettingsOpen: showPreferences, open, close };
}
