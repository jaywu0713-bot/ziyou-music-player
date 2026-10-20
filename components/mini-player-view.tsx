import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Music2,
  Pin,
  PanelTop,
  MoreHorizontal,
  X,
  Minus,
} from 'lucide-react';
import { translate } from '@/lib/i18n/core';
import {
  MINI_ACTION,
  MINI_STATE,
  MINI_COVER,
  MINI_REQUEST,
  type CollapsedStyle,
  type MiniSnapshot,
  type MiniAction,
  type MiniPreferences,
} from '@/lib/desktop/mini-player';
import './mini-player.css';
const clock = (n: number) =>
  `${Math.floor(Math.max(0, n) / 60)}:${String(Math.floor(Math.max(0, n) % 60)).padStart(2, '0')}`;
export function MiniPlayerView() {
  const [state, setState] = useState<MiniSnapshot | null>(null);
  const [cover, setCover] = useState({ trackId: '', url: '' });
  const [prefs, setPrefs] = useState<MiniPreferences>({
    mode: 'both',
    pinned: true,
    collapsedStyle: 'edge-tab',
    collapsedActive: false,
  });
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState(false),
    [error, setError] = useState(''),
    [draft, setDraft] = useState<number | null>(null);
  const stateRef = useRef(state);
  const root = useRef<HTMLDivElement>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);
  const transition = useRef<Promise<void>>(Promise.resolve());
  const tr = (s: string) => translate(s, state?.language || 'zh-CN');
  const fail = (e: unknown) => setError(String(e));
  const send = (action: MiniAction) =>
    void emitTo('main', MINI_ACTION, action).catch(fail);
  const restore = () => void invoke('mini_restore_main').catch(fail);
  useEffect(() => {
    let disposed = false;
    const stops: Array<() => void> = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => void invoke('mini_save_bounds').catch(fail),
        300,
      );
    };
    async function add(promise: Promise<() => void>) {
      const stop = await promise;
      if (disposed) stop();
      else stops.push(stop);
    }
    void (async () => {
      await add(
        listen<MiniSnapshot>(MINI_STATE, ({ payload }) => {
          if (disposed) return;
          if (payload.trackId !== stateRef.current?.trackId) setDraft(null);
          stateRef.current = payload;
          setState(payload);
        }),
      );
      await add(
        listen<{ trackId: string; url: string }>(MINI_COVER, ({ payload }) => {
          if (!disposed) setCover(payload);
        }),
      );
      await add(
        listen<MiniPreferences>('ziyou:mini-preferences', ({ payload }) => {
          if (!disposed) {
            setPrefs(payload);
            setCollapsed(payload.collapsedActive);
          }
        }),
      );
      await add(getCurrentWindow().onMoved(save));
      await add(getCurrentWindow().onResized(save));
      const preferences = await invoke<MiniPreferences>('mini_preferences');
      if (disposed) return;
      setPrefs(preferences);
      setCollapsed(preferences.collapsedActive);
      await emitTo('main', MINI_REQUEST);
    })().catch((e) => {
      if (!disposed) fail(e);
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
      stops.forEach((stop) => stop());
    };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest('.mini-menu-wrap')
      )
        setMenu(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(false);
        root.current?.querySelector<HTMLButtonElement>('.mini-more')?.focus();
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', key);
    };
  }, [menu]);
  const seek = (value: number) => {
    if (state?.duration)
      send({ type: 'seek', value: Math.min(value, state.duration) });
    setDraft(null);
  };
  async function pin() {
    try {
      setPrefs(
        await invoke<MiniPreferences>('mini_save_preferences', {
          mode: null,
          pinned: !prefs.pinned,
          collapsedStyle: null,
        }),
      );
    } catch (e) {
      fail(e);
    }
  }
  async function saveCollapsedStyle(collapsedStyle: CollapsedStyle) {
    try {
      const saved = await invoke<MiniPreferences>('mini_save_preferences', {
        mode: null,
        pinned: null,
        collapsedStyle,
      });
      setPrefs(saved);
    } catch (e) {
      fail(e);
    }
  }
  async function collapse() {
    const next = transition.current.catch(() => {}).then(async () => {
      setPrefs(await invoke<MiniPreferences>('mini_collapse', { style: prefs.collapsedStyle }));
      setCollapsed(true);
    });
    transition.current = next.catch(() => {});
    await next.catch(fail);
  }
  async function expand() {
    if (didDrag.current) return;
    const next = transition.current.catch(() => {}).then(async () => {
      setPrefs(await invoke<MiniPreferences>('mini_expand'));
      setCollapsed(false);
    });
    transition.current = next.catch(() => {});
    await next.catch(fail);
  }
  const collapsedPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
    didDrag.current = false;
  };
  const collapsedPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = pointerStart.current;
    if (!start || didDrag.current) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) {
      didDrag.current = true;
      void getCurrentWindow().startDragging().catch(fail);
    }
  };
  const collapsedPointerUp = () => {
    pointerStart.current = null;
  };
  const styles = {
    '--mini-bg': state?.dark === false ? '#f5f7f4' : '#111315',
    '--mini-fg': state?.dark === false ? '#17201c' : '#edf2ee',
    '--mini-muted': state?.dark === false ? '#58645d' : '#adb8b0',
    '--mini-accent': state?.accent || '#a6ca82',
    '--mini-on-accent': state?.accentText || '#102015',
  } as CSSProperties;
  if (collapsed)
    return (
      <div ref={root} className={`mini-player mini-collapsed ${prefs.collapsedStyle}`} style={styles}>
        <button
          className="mini-expand-hit"
          aria-label={tr('展开迷你播放器')}
          title={tr('展开迷你播放器')}
          onPointerDown={collapsedPointerDown}
          onPointerMove={collapsedPointerMove}
          onPointerUp={collapsedPointerUp}
          onPointerCancel={collapsedPointerUp}
          onClick={() => void expand()}
        >
          {prefs.collapsedStyle === 'cover-tile' && cover.url && cover.trackId === state?.trackId ? (
            // Native thumbnail; desktop has no image optimization server.
            // oxlint-disable-next-line nextjs/no-img-element
            <img src={cover.url} alt={tr('展开迷你播放器')} />
          ) : prefs.collapsedStyle === 'cover-tile' ? (
            <Music2 size={32} />
          ) : (
            <span>{state?.name || tr('迷你播放器')}</span>
          )}
        </button>
        {error && <p className="mini-error" role="alert">{error}</p>}
      </div>
    );
  return (
    <div ref={root} className="mini-player" style={styles}>
      <header className="mini-header">
        <span>{tr('迷你播放器')}</span>
        <div className="mini-tools">
          <button aria-label={tr('收起迷你播放器')} title={tr('收起迷你播放器')} onClick={() => void collapse()}>
            <Minus size={15} />
          </button>
          <button
            aria-label={tr('返回主界面')}
            title={tr('返回主界面')}
            onClick={restore}
          >
            <PanelTop size={15} />
          </button>
          <button
            aria-label={tr('置顶')}
            aria-pressed={prefs.pinned}
            title={tr(prefs.pinned ? '关闭置顶' : '开启置顶')}
            onClick={() => void pin()}
          >
            <Pin size={15} />
          </button>
          <div className="mini-menu-wrap">
            <button
              className="mini-more"
              aria-label={tr('显示模式')}
              aria-expanded={menu}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setMenu((open) => !open)}
            >
              <MoreHorizontal size={17} />
            </button>
            {menu && (
              <fieldset className="mini-menu" aria-label={tr('显示模式')}>
                <button
                  aria-pressed={prefs.mode === 'both'}
                  onClick={() => {
                    send({ type: 'mode', value: 'both' });
                    setMenu(false);
                  }}
                >
                  {tr('同时显示')}
                </button>
                <div className="mini-menu-label">{tr('收起样式')}</div>
                <button aria-pressed={prefs.collapsedStyle === 'edge-tab'} onClick={() => void saveCollapsedStyle('edge-tab')}>
                  {tr('屏幕边缘标签')}
                </button>
                <button aria-pressed={prefs.collapsedStyle === 'cover-tile'} onClick={() => void saveCollapsedStyle('cover-tile')}>
                  {tr('专辑封面方块')}
                </button>
                <button
                  aria-pressed={prefs.mode === 'mini-only'}
                  onClick={() => {
                    send({ type: 'mode', value: 'mini-only' });
                    setMenu(false);
                  }}
                >
                  {tr('仅迷你播放器')}
                </button>
              </fieldset>
            )}
          </div>
          <button
            aria-label={tr('关闭迷你播放器')}
            title={tr('关闭迷你播放器')}
            onClick={restore}
          >
            <X size={15} />
          </button>
        </div>
      </header>
      <div className="mini-track">
        <div className="mini-cover">
          {cover.url && cover.trackId === state?.trackId ? (
            // Native thumbnail; desktop has no image optimization server.
            // oxlint-disable-next-line nextjs/no-img-element
            <img src={cover.url} alt={tr('当前歌曲封面')} />
          ) : (
            <Music2 size={28} />
          )}
        </div>
        <div className="mini-copy">
          <strong title={state?.name}>
            {state?.name || tr('选一首，开始听')}
          </strong>
          <span>
            {state?.preparing
              ? tr('正在准备播放…')
              : state?.version === 'instrumental'
                ? tr('伴奏')
                : tr('原曲')}
          </span>
        </div>
      </div>
      <div className="mini-controls">
        <button
          aria-label={tr('上一首')}
          disabled={!state?.canSkip}
          onClick={() => send({ type: 'previous' })}
        >
          <SkipBack size={19} />
        </button>
        <button
          className="mini-play"
          aria-label={tr(
            state?.preparing ? '取消准备' : state?.playing ? '暂停' : '播放',
          )}
          disabled={!state?.canPlay}
          onClick={() => send({ type: 'toggle' })}
        >
          {state?.playing ? (
            <Pause size={21} fill="currentColor" />
          ) : (
            <Play size={21} fill="currentColor" />
          )}
        </button>
        <button
          aria-label={tr('下一首')}
          disabled={!state?.canSkip}
          onClick={() => send({ type: 'next' })}
        >
          <SkipForward size={19} />
        </button>
      </div>
      <div className="mini-seek">
        <span>{clock(draft ?? state?.position ?? 0)}</span>
        <input
          type="range"
          aria-label={tr('播放进度')}
          min={0}
          max={state?.duration || 1}
          step={0.1}
          value={Math.min(draft ?? state?.position ?? 0, state?.duration || 1)}
          disabled={!state?.duration || state.preparing || !state.canPlay}
          onChange={(event) => setDraft(Number(event.target.value))}
          onPointerUp={(event) => seek(Number(event.currentTarget.value))}
          onKeyUp={(event) => {
            if (
              [
                'ArrowLeft',
                'ArrowRight',
                'ArrowUp',
                'ArrowDown',
                'Home',
                'End',
                'PageUp',
                'PageDown',
              ].includes(event.key)
            )
              seek(Number(event.currentTarget.value));
          }}
          onPointerCancel={() => setDraft(null)}
          onBlur={() => setDraft(null)}
        />
        <span>{clock(state?.duration || 0)}</span>
      </div>
      <footer className="mini-volume">
        <Volume2 size={15} />
        <input
          type="range"
          aria-label={tr('音量')}
          min={0}
          max={100}
          step={1}
          value={state?.volume ?? 0}
          disabled={!state?.canPlay}
          onChange={(event) =>
            send({ type: 'volume', value: Number(event.target.value) })
          }
        />
        <span>{Math.round(state?.volume || 0)}%</span>
      </footer>
      {state?.message && !error && (
        <output className="mini-error">{tr(state.message)}</output>
      )}
      {error && (
        <p className="mini-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
