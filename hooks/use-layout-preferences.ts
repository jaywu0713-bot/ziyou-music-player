'use client';
import { useEffect, useRef, useState } from 'react';
export type LayoutPreferences = {
  navScale: number;
  playerScale: number;
  navCollapsed: boolean;
  playerCollapsed: boolean;
};
export const defaultLayout: LayoutPreferences = {
  navScale: 100,
  playerScale: 100,
  navCollapsed: false,
  playerCollapsed: false,
};
const key = 'ziyou:layout-scale:v1';
function normalize(
  value: Partial<LayoutPreferences> | null,
): LayoutPreferences {
  const scale = (n: unknown) =>
    typeof n === 'number' && Number.isFinite(n)
      ? Math.max(80, Math.min(125, n))
      : 100;
  return {
    navScale: scale(value?.navScale),
    playerScale: scale(value?.playerScale),
    navCollapsed: value?.navCollapsed === true,
    playerCollapsed: value?.playerCollapsed === true,
  };
}
export function useLayoutPreferences(queueOpen: boolean) {
  const [value, setValue] = useState(defaultLayout);
  const [width, setWidth] = useState(1280);
  const [playerHeight, setPlayerHeight] = useState(112);
  const dock = useRef<HTMLDivElement>(null);
  const latest = useRef(defaultLayout);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        latest.current = normalize(
          JSON.parse(localStorage.getItem(key) || 'null'),
        );
        setValue(latest.current);
      } catch {}
      setWidth(window.innerWidth);
    });
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    const observer = new ResizeObserver(() => {
      if (dock.current)
        setPlayerHeight(dock.current.getBoundingClientRect().height);
    });
    if (dock.current) observer.observe(dock.current);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', resize);
      observer.disconnect();
    };
  }, []);
  function change(patch: Partial<LayoutPreferences>) {
    const next = normalize({ ...latest.current, ...patch });
    latest.current = next;
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  }

  return {
    value,
    change,
    dock,
    playerHeight,
    navScale: Math.min(
      value.navScale / 100,
      Math.max(
        0.8,
        (width -
          360 -
          (queueOpen && width >= 768 ? (width > 1000 ? 260 : 220) : 0)) /
          256,
      ),
    ),
    playerScale: Math.min(
      value.playerScale / 100,
      width < 768 ? 1 : Math.max(0.8, width / 1100),
    ),
  };
}
