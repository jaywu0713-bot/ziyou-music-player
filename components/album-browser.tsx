'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Disc3, ListPlus, Play } from 'lucide-react';
import type { Track } from '@/lib/music/model';
import {
  albumCredits,
  buildAlbums,
  type Album,
  type AlbumTrackInfo,
} from '@/lib/music/albums';
import { useCover } from '@/hooks/use-cover';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n/react';
import { message } from '@/lib/i18n/core';
import './album-browser.css';
// Limit artwork reads across visible cards; the playing-song artwork remains independent.
const waiting: (() => void)[] = [];
let active = 0;
async function scheduleArtwork(job: () => Promise<void>) {
  if (active >= 2) await new Promise<void>((r) => waiting.push(r));
  else active++;
  try {
    await job();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
function AlbumArtwork({
  album,
  resolve,
  revision,
}: {
  album: Album;
  resolve: (t: Track) => Promise<File>;
  revision: number;
}) {
  const node = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { rootMargin: '160px' },
    );
    if (node.current) observer.observe(node.current);
    return () => observer.disconnect();
  }, []);
  // Revision remounts this component after an edited cover is saved.
  void revision;
  const cover = useCover(
    visible ? album.tracks[0] : undefined,
    resolve,
    scheduleArtwork,
  );
  return (
    <div ref={node} className="album-artwork">
      {cover.url ? (
        // oxlint-disable-next-line next/no-img-element -- Cached object URLs are local.
        <img src={cover.url} alt="" />
      ) : (
        <Disc3 size={48} aria-hidden="true" />
      )}
    </div>
  );
}
type Props = {
  tracks: Track[];
  metadata: Record<string, AlbumTrackInfo>;
  resolve: (t: Track) => Promise<File>;
  current: string | null;
  disabled: boolean;
  loading: boolean;
  failed: number;
  onRetry: () => void;
  onPlay: (id: string, queue: string[]) => void;
  onQueue: (ids: string[]) => void;
  onEdit: (id: string) => void;
  coverRevision: number;
};
export function AlbumBrowser({
  tracks,
  metadata,
  resolve,
  current,
  disabled,
  loading,
  failed,
  onRetry,
  onPlay,
  onQueue,
  onEdit,
  coverRevision,
}: Props) {
  const tr = useTranslation();
  const albums = useMemo(
    () => buildAlbums(tracks, metadata),
    [tracks, metadata],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');
  const container = useRef<HTMLElement>(null);
  const scroll = useRef(0);
  const album = albums.find((a) => a.id === selected);
  const matching = albums
    .filter((a) =>
      `${a.name} ${a.artist}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) =>
      sort === 'artist'
        ? a.artist.localeCompare(b.artist, 'zh-CN') ||
          a.name.localeCompare(b.name, 'zh-CN')
        : sort === 'count'
          ? b.tracks.length - a.tracks.length
          : 0,
    );
  function open(id: string) {
    scroll.current =
      (container.current?.closest('.workspace-content')?.scrollTop ??
        container.current?.scrollTop) ||
      0;
    setSelected(id);
    (
      container.current?.closest('.workspace-content') || container.current
    )?.scrollTo({ top: 0 });
  }
  function back() {
    setSelected(null);
    requestAnimationFrame(() =>
      (
        container.current?.closest('.workspace-content') || container.current
      )?.scrollTo({ top: scroll.current }),
    );
  }

  return (
    <section ref={container} className="album-browser" aria-label={tr('专辑浏览')}>
      {album ? (
        <>
          <Button variant="ghost" onClick={back}>
            <ArrowLeft size={17} />
            {tr('返回专辑')}
          </Button>
          <div className="album-detail-heading">
            <AlbumArtwork
              key={`${album.id}:${coverRevision}`}
              album={album}
              resolve={resolve}
              revision={coverRevision}
            />
            <div>
              <p className="album-kind">{tr('专辑')}</p>
              <h1>{album.name}</h1>
              <p>{album.artist || tr('艺人信息未知')}</p>
              <p>{album.tracks.length} {tr('首歌曲')}</p>
              <div className="album-detail-actions">
                <Button
                  disabled={disabled || !album.tracks.length}
                  onClick={() =>
                    onPlay(
                      album.tracks[0].id,
                      album.tracks.map((t) => t.id),
                    )
                  }
                >
                  <Play size={16} />
                  {tr('播放全部')}
                </Button>
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => onQueue(album.tracks.map((t) => t.id))}
                >
                  <ListPlus size={16} />
                  {tr('加入队列')}
                </Button>
              </div>
            </div>
          </div>
          <div className="album-song-list">
            {album.tracks.map((t, index) => (
              <div
                key={t.id}
                className={`album-song ${current === t.id ? 'is-current' : ''}`}
              >
                <span className="album-song-number">
                  {metadata[t.id]?.discNumber && metadata[t.id]?.trackNumber
                    ? `${metadata[t.id].discNumber}-${metadata[t.id].trackNumber}`
                    : metadata[t.id]?.trackNumber || index + 1}
                </span>
                <button
                  className="album-song-play"
                  disabled={disabled || t.missing}
                  onClick={() =>
                    onPlay(
                      t.id,
                      album.tracks.map((t) => t.id),
                    )
                  }
                >
                  <strong>{metadata[t.id]?.title || t.name}</strong>
                  <span>
                    {t.missing
                      ? tr('文件暂时无法访问')
                      : albumCredits(t, metadata[t.id]).artists.join('、')}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  disabled={disabled}
                  aria-label={tr(message('将 {0} 加入队列', {0:t.name}))}
                  onClick={() => onQueue([t.id])}
                >
                  <ListPlus size={17} />
                </Button>
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => onEdit(t.id)}
                >
                  {tr('整理')}
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <header className="album-browser-heading">
            <div>
              <h1>{tr('专辑')}</h1>
              <p>{albums.length} {tr('张专辑')}</p>
            </div>
            <div className="album-browser-tools">
              <input
                aria-label={tr('搜索专辑')}
                placeholder={tr('搜索专辑或艺人')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                aria-label={tr('专辑排序')}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="name">{tr('按专辑名称')}</option>
                <option value="artist">{tr('按艺人')}</option>
                <option value="count">{tr('按歌曲数量')}</option>
              </select>
            </div>
          </header>
          {loading && (
            <output className="album-status">
              {tr('正在读取专辑资料，已有专辑可继续浏览。')}
            </output>
          )}
          {!!failed && (
            <p className="album-status">
              {failed} {tr('首歌曲暂时无法读取资料。')}
              <Button variant="ghost" onClick={onRetry}>
                {tr('重试读取')}
              </Button>
            </p>
          )}
          <div className="album-grid">
            {matching.map((a) => (
              <button
                key={a.id}
                className="album-card"
                onClick={() => open(a.id)}
                aria-label={tr(message('打开专辑 {0} {1}', {0:a.name,1:a.artist}))}
              >
                <AlbumArtwork
                  key={`${a.id}:${coverRevision}`}
                  album={a}
                  resolve={resolve}
                  revision={coverRevision}
                />
                <strong title={a.name}>{a.name}</strong>
                <span title={a.artist}>{a.artist || tr('艺人信息未知')}</span>
                <small>{a.tracks.length} {tr('首歌曲')}</small>
              </button>
            ))}
          </div>
          {!matching.length && (
            <p className="album-empty">
              {query
                ? tr('没有匹配的专辑，请调整搜索词。')
                : tr('导入本地音乐后，专辑会自动显示在这里。')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
