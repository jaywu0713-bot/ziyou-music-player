import { useEffect, useState, type CSSProperties } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { availableMonitors, getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window';
import { lyricLine, visibleLyricPosition, type DesktopLyricsSnapshot, type LyricPart } from '@/lib/desktop/lyrics-state';
import { translate } from '@/lib/i18n/core';
import {
  DESKTOP_LYRICS_EVENT,
  DESKTOP_LYRICS_HIDDEN_EVENT,
  DESKTOP_LYRICS_REQUEST_EVENT,
} from '@/lib/desktop/window';

const emptySnapshot: DesktopLyricsSnapshot = {
  trackName: '',
  current: [],
  next: [],
  active: -1,
  fontSize: 28,
  fontFamily: 'sans',
};

export function DesktopLyricsView() {
  const part: LyricPart = new URLSearchParams(window.location.search).get('part') === 'next' ? 'next' : 'current';
  const positionKey = part === 'next' ? 'ziyou.desktop-lyrics-next-position' : 'ziyou.desktop-lyrics-position';
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const lineLabel = translate(part === 'next' ? '歌词 2' : '歌词 1', snapshot.language);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let unlistenMoved: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    let alive = true;
    void (async () => {
      const lyricListener = await listen<DesktopLyricsSnapshot>(DESKTOP_LYRICS_EVENT, (event) => {
        if (alive) setSnapshot(event.payload);
      });
      if (alive) unlisten = lyricListener;
      else lyricListener();
      const window = getCurrentWindow();
      const saved = localStorage.getItem(positionKey);
      let position: {x:number;y:number} | null = null;
      if (saved) try {
        const parsed = JSON.parse(saved) as {x?:number;y?:number};
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) position={x:parsed.x!,y:parsed.y!};
      } catch {}
      const [monitors,size]=await Promise.all([availableMonitors(),window.outerSize()]);
      const safe=visibleLyricPosition(position,size,monitors);
      await window.setPosition(new PhysicalPosition(safe.x,safe.y));
      unlistenMoved = await window.onMoved(async () => {
        const position = await window.outerPosition();
        localStorage.setItem(
          positionKey,
          JSON.stringify({ x: position.x, y: position.y }),
        );
      });
      unlistenClose = await window.onCloseRequested((event) => {
        event.preventDefault();
        void window.hide().then(() => emit(DESKTOP_LYRICS_HIDDEN_EVENT, part));
      });
      await emit(DESKTOP_LYRICS_REQUEST_EVENT);
    })();
    return () => {
      alive = false;
      unlisten?.();
      unlistenMoved?.();
      unlistenClose?.();
    };
  }, [part, positionKey]);

  return (
    <button
      className="desktop-lyrics-root"
      aria-label={snapshot.trackName ? translate('{0}：{1}', snapshot.language, {0:lineLabel,1:snapshot.trackName}) : translate('歌词', snapshot.language)}
      onMouseDown={() => {
        if (isTauri()) void getCurrentWindow().startDragging();
      }}
      type="button"
    >
      <div
        className="desktop-lyrics-copy"
        style={{
          fontSize: `${snapshot.fontSize}px`,
          '--lyric-accent':snapshot.accentColor || '#e8c96a',
          fontFamily:
            snapshot.fontFamily === 'serif'
              ? 'Iowan Old Style, Songti SC, serif'
              : 'system-ui, PingFang SC, sans-serif',
        } as CSSProperties}
      >
        <p className={snapshot.active === (part === 'next' ? 1 : 0) ? 'is-current' : 'desktop-lyrics-next'}>{lyricLine(snapshot,part)}</p>
      </div>
    </button>
  );
}
