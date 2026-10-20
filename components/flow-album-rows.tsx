'use client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Complete rows retain their ordering and alignment when either list ends.
export function FlowAlbumRows({ children }: { children: ReactNode[] }) {
  const marker = useRef<HTMLDivElement>(null);
  const [counts, setCounts] = useState<number[]>([]);
  useLayoutEffect(() => {
    const node = marker.current;
    const workspace = node?.closest('.flow-workspace');
    if (!node || !workspace) return;
    let frame = 0;
    function update() {
      const root = workspace!.getBoundingClientRect();
      const start = node!.getBoundingClientRect().top;
      const nav = workspace!
        .querySelector('.flow-navigation')
        ?.getBoundingClientRect();
      const queue = workspace!
        .querySelector('.flow-queue')
        ?.getBoundingClientRect();
      const first = workspace!
        .querySelector('.album-card')
        ?.getBoundingClientRect();
      const cardWidth = Math.max(140, Math.min(180, window.innerWidth * 0.14));
      const rowHeight = (first?.height || cardWidth + 80) + 24;
      const rows: number[] = [];
      let remaining = children.length;
      let top = start;
      while (remaining > 0) {
        const left =
          nav && top < nav.bottom - 1 && nav.width < root.width * 0.9
            ? nav.width + 12
            : 0;
        const right =
          queue && top < queue.bottom - 1 && queue.width < root.width * 0.9
            ? queue.width + 12
            : 0;
        const columns = Math.max(
          1,
          Math.floor(
            (workspace!.clientWidth - left - right - 40 + 20) /
              (cardWidth + 20),
          ),
        );
        const count = Math.min(remaining, columns);
        rows.push(count);
        remaining -= count;
        top += rowHeight;
      }
      setCounts((old) =>
        old.length === rows.length && old.every((v, i) => v === rows[i])
          ? old
          : rows,
      );
    }
    function measure() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }
    const observer = new ResizeObserver(measure);
    [
      workspace,
      workspace.querySelector('.flow-navigation'),
      workspace.querySelector('.flow-queue'),
      workspace.querySelector('.album-browser-heading'),
      workspace.querySelector('.album-card'),
    ].forEach((n) => {
      if (n) observer.observe(n);
    });
    const mutations = new MutationObserver(measure);
    mutations.observe(workspace, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
    });
    update();
    return () => {
      mutations.disconnect();
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [children.length]);
  let offset = 0;
  const rows: ReactNode[][] = [];
  for (const count of counts.length ? counts : [children.length]) {
    rows.push(children.slice(offset, offset + count));
    offset += count;
  }
  return (
    <div className="album-grid flow-album-rows">
      <div ref={marker} className="flow-album-start" />
      {rows.map((items, i) => {
        return (
          <div className="flow-album-row" key={i}>
            {items}
          </div>
        );
      })}
    </div>
  );
}
