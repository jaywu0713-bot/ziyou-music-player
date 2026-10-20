'use client';
import { useTranslation } from '@/lib/i18n/react';
/* oxlint-disable next/no-img-element -- Local blobs and fixed artwork proxy are already sized; no server optimizer. */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Track } from '@/lib/music/model';
import {
  coverKey,
  normalizeCover,
  type CoverRecord,
  type CoverCandidate,
} from '@/lib/music/covers';
import { coverStorage } from '@/lib/music/storage';
import { invoke } from '@tauri-apps/api/core';
import { isDesktopApp } from '@/lib/music/files';
import { coverImageUrl, searchCoverCandidates, downloadCoverImage } from '@/lib/desktop/covers';
export function CoverPanel({
  open,
  onOpenChange,
  track,
  record,
  url,
  onSaved,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  track?: Track;
  record?: CoverRecord;
  url: string;
  onSaved: () => void;
  disabled: boolean;
}) {
  const tr = useTranslation();
  const [title, setTitle] = useState(
      record?.title || track?.name.replace(/\.[^.]+$/, '') || '',
    ),
    [artist, setArtist] = useState(record?.artist || ''),
    [album, setAlbum] = useState(record?.album || '');
  const [results, setResults] = useState<CoverCandidate[]>([]),
    [selected, setSelected] = useState<CoverCandidate>();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [searched, setSearched] = useState(false);
  const [upload, setUpload] = useState<Blob>();
  const lifecycle = useRef(new AbortController());
  const preview = useMemo(
    () => (upload ? URL.createObjectURL(upload) : ''),
    [upload],
  );
  const input = useRef<HTMLInputElement>(null),
    job = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  async function search() {
    const life = lifecycle.current.signal;
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    setBusy('正在搜索…');
    setError('');
    setSelected(undefined);
    setUpload(undefined);
    setResults([]);
    setSearched(false);
    try {
      const candidates = await searchCoverCandidates(
        isDesktopApp(), { title, artist, album }, fetch, invoke,
        AbortSignal.any([controller.signal, life, AbortSignal.timeout(18000)]),
      );
      if (!controller.signal.aborted && !life.aborted) {
        setResults(candidates);
        setSearched(true);
      }
    } catch (e) {
      if (!controller.signal.aborted && !life.aborted)
      setError(tr(e instanceof Error ? e.message : '搜索失败，请重试。'));
    } finally {
      if (!controller.signal.aborted && !life.aborted) setBusy('');
    }
  }
  async function save(restore = false) {
    if (!track || disabled) return;
    const target = track,
      life = lifecycle.current.signal;
    const controller = new AbortController();
    job.current?.abort();
    job.current = controller;
    setBusy('正在保存…');
    setError('');
    try {
      if (restore) await coverStorage(coverKey(target, true), 'delete');
      else {
        let blob = upload;
        if (!blob && selected) {
          blob = await normalizeCover(await downloadCoverImage(
            isDesktopApp(), selected.id, fetch, invoke,
            AbortSignal.any([controller.signal, life, AbortSignal.timeout(18000)]),
          ));
        }
        if (!blob) throw new Error("请先选择封面。");
        if (life.aborted) return;
        await coverStorage<CoverRecord>(coverKey(target, true), 'write', {
          blob,
          source: upload ? 'upload' : 'online',
          label: upload ? "本地图片" : selected?.title,
        });
      }
      if (!life.aborted) {
        onSaved();
        onOpenChange(false);
      }
    } catch (e) {
      if (!life.aborted)
        setError(
          e instanceof Error ? e.message : '保存失败，请检查浏览器存储空间。',
        );
    } finally {
      if (!life.aborted) setBusy('');
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="music-dialog cover-dialog">
        <DialogTitle>{tr("歌曲封面")}</DialogTitle>
        <DialogDescription>
          {track?.name || tr("请先选择歌曲")} {tr("· 仅应用于这首歌曲")}</DialogDescription>
        <div className="cover-actions">
          <Button
            variant="outline"
            disabled={disabled || !!busy}
            onClick={() => input.current?.click()}
          >
            {tr("上传本地图片")}</Button>
          <Button
            variant="ghost"
            disabled={
              disabled ||
              !!busy ||
              !['upload', 'online'].includes(record?.source || '')
            }
            onClick={() => void save(true)}
          >
            {tr("恢复默认封面")}</Button>
        </div>
        <input
          hidden
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label={tr("上传歌曲封面")}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const life = lifecycle.current.signal;
            setBusy('正在读取图片…');
            setError('');
            try {
              const blob = await normalizeCover(file);
              if (!life.aborted) {
                setUpload(blob);
                setSelected(undefined);
              }
            } catch (e) {
              if (!life.aborted)
                setError(e instanceof Error ? e.message : '图片无法读取。');
            } finally {
              if (!life.aborted) setBusy('');
            }
          }}
        />
        <form
          className="cover-search"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <label htmlFor="cover-title">
            {tr("歌曲名称")}<Input
              id="cover-title"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label htmlFor="cover-artist">
            {tr("歌手（可选）")}<Input
              id="cover-artist"
              value={artist}
              maxLength={200}
              onChange={(e) => setArtist(e.target.value)}
            />
          </label>
          <label htmlFor="cover-album">
            {tr("专辑（可选）")}<Input
              id="cover-album"
              value={album}
              maxLength={200}
              onChange={(e) => setAlbum(e.target.value)}
            />
          </label>
          <Button
            type="submit"
            disabled={!!busy || (!title.trim() && !album.trim())}
          >
            {tr("搜索封面")}</Button>
        </form>
        <p className="cover-source">
          {tr("来源：MusicBrainz / Cover Art Archive。搜索仅发送关键词，音乐留在本机。")}</p>
        {busy && <output>{tr(busy)}</output>}
        {error && (
          <p role="alert" className="cover-error">
            {tr(error)}
          </p>
        )}
        {searched && !results.length && (
          <p>{tr("没有找到对应专辑，可修改关键词或上传本地图片。")}</p>
        )}
        <div className="cover-results">
          {results.map((item) => (
            <CoverOption
              key={item.id}
              item={item}
              desktop={isDesktopApp()}
              selected={selected?.id === item.id}
              disabled={!!busy}
              onSelect={() => {
                setSelected(item);
                setUpload(undefined);
                setError('');
              }}
            />
          ))}
        </div>
        {(preview || selected || url) && (
          <div className="cover-preview">
            <img
              src={
                preview || (selected ? coverImageUrl(isDesktopApp(), selected.id) : url)
              }
              alt={tr("封面预览")}
            />
            <span>{upload ? tr("本地图片") : selected?.title || tr("当前封面")}</span>
          </div>
        )}
        <Button
          disabled={disabled || !!busy || (!upload && !selected)}
          onClick={() => void save()}
        >
          {tr("使用此封面")}</Button>
      </DialogContent>
    </Dialog>
  );
}

function CoverOption({
  item,
  desktop,
  selected,
  disabled,
  onSelect,
}: {
  item: CoverCandidate;
  desktop: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const tr = useTranslation();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled || status !== 'ready'}
      onClick={onSelect}
    >
      <img
        src={coverImageUrl(desktop, item.id)}
        loading="lazy"
        alt={item.title + tr("封面")}
        style={{ visibility: status === 'error' ? 'hidden' : 'visible' }}
        onLoad={() => setStatus('ready')}
        onError={() => setStatus('error')}
      />
      <strong>{item.title}</strong>
      <span>{item.artist || tr("未知歌手")}</span>
      {status !== 'ready' && (
        <small>
          {status === 'loading'
            ? tr("正在读取封面…")
            : tr("封面暂不可用，请尝试其他版本")}
        </small>
      )}
    </button>
  );
}
