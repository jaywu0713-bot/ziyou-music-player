'use client';
import { message } from '@/lib/i18n/core';
import { displayMessage as tr } from '@/lib/i18n/core';
import { useTranslation } from '@/lib/i18n/react';

import { useEffect, useRef, useState } from 'react';
import { FileText, PictureInPicture2, Search, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import type { Track } from '@/lib/music/model';
import { activeLyricIndex, decodeLyrics, lyricsSearchTitle, MAX_LYRICS_BYTES, parseLyrics, type LyricsEncoding, type LyricsRecord } from '@/lib/music/lyrics';
import { candidateLyrics, rankLyrics, searchLyrics, type LyricsCandidate } from '@/lib/music/lyrics-search';
import { effectiveCredits, recognitionQuery } from '@/lib/music/identification';

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const kindLabel = (record: LyricsRecord) => ({ synced: tr("同步歌词"), plain: tr("纯文本 · 无时间标记"), instrumental: tr("纯音乐") })[record.parsed.kind];

function LyricsView({ record, positionMs, preview = false }: { record: LyricsRecord; positionMs: number; preview?: boolean }) {
  const tr = useTranslation();
  const active = preview ? -1 : activeLyricIndex(record.parsed, positionMs, record.adjustmentMs);
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (!follow || active < 0) return;
    const container = scroller.current;
    const element = container?.querySelector<HTMLElement>(`[data-line-index="${active}"]`);
    if (container && element) {
      container.scrollTo({ top: element.offsetTop - container.clientHeight / 2 + element.clientHeight / 2, behavior: 'auto' });
    }
  }, [active, follow]);
  return <div className="lyrics-view">
    {record.parsed.kind === 'plain' && <p className="lyrics-caption">{tr("这份歌词没有时间标记，可阅读，暂不跟随播放高亮。")}</p>}
    <div className="lyrics-scroll" ref={scroller} tabIndex={0} aria-label={preview ? tr("歌词预览") : tr("歌词正文")}
      onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)}
      onPointerDown={() => setFollow(false)}
      onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) setFollow(false); }}>
      {record.parsed.kind === 'synced' ? record.parsed.lines.map((line, index) =>
        <div key={line.timeMs} data-line-index={index} data-active={active === index ? 'true' : 'false'}
          aria-current={active === index ? 'true' : undefined} className={`lyric-line${active === index ? ' is-active' : ''}`}>
          {preview && <span className="lyric-timestamp">{formatTime(line.timeMs / 1000)}</span>}
          {line.texts.map((text, i) => <p key={i}>{text || '♪'}</p>)}
        </div>) : record.parsed.kind === 'instrumental' ? <div className="lyrics-empty"><FileText size={30} /><p>{tr("这首歌被标记为纯音乐")}</p></div> : <p className="lyrics-plain">{record.parsed.plainText}</p>}
    </div>
    {!preview && !follow && record.parsed.kind === 'synced' && <Button size="sm" variant="secondary" className="lyrics-follow" onClick={() => setFollow(true)}>{tr("回到当前歌词")}</Button>}
  </div>;
}

/** Mounted with the current track ID as key; unmount cancels all pending work. */
export function LyricsPanel({ track, positionMs, readOnly, floating, onClose, onSave, playerHeight }: {
  track: Track | undefined;
  positionMs: number;
  playerHeight: number;
  readOnly: boolean;
  floating: { available: boolean; opening: boolean; open: boolean; interactive?: boolean; settingsAvailable?: boolean; error: string; onOpen: () => void; onSettings: () => void; onClose: () => void; onToggleInteraction?: () => void };
  onClose: () => void;
  onSave: (trackId: string, lyrics: LyricsRecord | undefined) => void;
}) {
  const tr = useTranslation();
  const [mode, setMode] = useState<'view' | 'import' | 'search'>('view');
  const filenameClues = recognitionQuery(track?.name || '');
  const [title, setTitle] = useState(filenameClues.title || lyricsSearchTitle(track?.name || ''));
  const [artist, setArtist] = useState(track ? effectiveCredits(track).artists[0] || filenameClues.artist : '');
  const [results, setResults] = useState<LyricsCandidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<LyricsRecord | null>(null);
  const [encoding, setEncoding] = useState<LyricsEncoding>('utf-8');
  const [local, setLocal] = useState<{ bytes: ArrayBuffer; name: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { generation.current++; request.current?.abort(); }, []);

  const cancel = () => { generation.current++; request.current?.abort(); request.current = null; setLoading(false); };
  const switchMode = (value: typeof mode) => {
    cancel(); setMode(value); setDraft(null); setError(''); setConfirmRemove(false); setLocal(null);
  };
  const stageLocal = (bytes: ArrayBuffer, name: string, selectedEncoding?: LyricsEncoding) => {
    try {
      const decoded = decodeLyrics(bytes, selectedEncoding);
      const parsed = parseLyrics(decoded.text);
      if (!parsed.lines.length && !parsed.plainText) throw new Error("文件里没有可显示的歌词，请选择其他 .lrc 文件。");
      setEncoding(decoded.encoding);
      setDraft({ version: 1, source: 'local', label: name, rawText: decoded.text, parsed, adjustmentMs: 0, updatedAt: Date.now() });
      setError('');
    } catch (cause) { setDraft(null); setError(cause instanceof TypeError ? '无法用当前编码读取歌词，请尝试其他文字编码。' : cause instanceof Error ? cause.message : '无法读取歌词，请尝试其他文字编码。'); }
  };
  const importFile = async (file?: File) => {
    if (!file || !track || readOnly) return;
    cancel(); setDraft(null); setLocal(null); setError('');
    if (!/\.lrc$/i.test(file.name)) { setError('请选择 .lrc 歌词文件。'); return; }
    if (file.size > MAX_LYRICS_BYTES) { setError('歌词文件过大，请选择 512 KB 以内的 .lrc 文件。'); return; }
    const id = generation.current;
    setLoading(true);
    try {
      const bytes = await file.arrayBuffer();
      if (id !== generation.current) return;
      setLocal({ bytes, name: file.name }); stageLocal(bytes, file.name);
    } catch { if (id === generation.current) setError('读取歌词失败，请重新选择文件。'); }
    finally { if (id === generation.current) setLoading(false); }
  };
  const search = async () => {
    if (!track || readOnly) return;
    cancel(); setDraft(null); setError(''); setResults([]); setSearched(false);
    const controller = new AbortController(); request.current = controller;
    const id = generation.current;
    setLoading(true);
    try {
      const found = await searchLyrics(title, artist, controller.signal);
      if (id !== generation.current) return;
      setResults(rankLyrics(found, track.duration)); setSearched(true);
    } catch (cause) {
      if (id === generation.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '搜索失败，请稍后重试。');
    } finally { if (id === generation.current) setLoading(false); }
  };
  const saved = track?.lyrics;
  const save = (record: LyricsRecord | undefined) => {
    if (track && !readOnly) onSave(track.id, record ? { ...record, updatedAt: Date.now() } : undefined);
  };

  return <Sheet open modal={false} disablePointerDismissal onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent style={{bottom: playerHeight, height: `calc(100dvh - ${playerHeight}px)`}} className="lyrics-sheet" showOverlay={false} showCloseButton={false}>
      <SheetHeader className="lyrics-header">
        <SheetTitle>{tr("歌词")}</SheetTitle>
        <SheetDescription>{track?.name || tr("先选择一首音乐播放")}</SheetDescription>
        <Button variant="ghost" size="icon-sm" aria-label={tr("关闭歌词")} className="lyrics-close" onClick={onClose}><X /></Button>
      </SheetHeader>
      <div className="lyrics-floating-tools">
        <Button size="sm" variant="outline" disabled={floating.opening || !track} onClick={floating.onOpen}>
          <PictureInPicture2 size={16} />{floating.opening ? tr("正在打开…") : floating.open ? tr("回到歌词小窗") : tr("悬浮歌词")}
        </Button>
        {floating.open && <>{floating.settingsAvailable === false && <Button size="sm" variant="outline" onClick={floating.onToggleInteraction}>{floating.interactive ? tr("恢复点击穿透") : tr("允许拖动歌词")}</Button>}{floating.settingsAvailable !== false && <Button size="sm" variant="ghost" onClick={floating.onSettings}>{tr("小窗偏好")}</Button>}
          <Button size="sm" variant="ghost" onClick={floating.onClose}>{tr("关闭小窗")}</Button></>}
        {!floating.available && <p className="lyrics-caption">{tr("小窗口需使用支持的桌面浏览器，可尝试用 Chrome 或 Edge 单独打开此网页。")}</p>}
        {floating.settingsAvailable === false && <p className="lyrics-caption">{tr("歌词小窗默认点击穿透。点“允许拖动歌词”后可用鼠标移动；再点恢复穿透，也可按 ⌘⇧L 切换。")}</p>}
      </div>
      {floating.error && <p className="lyrics-error" role="alert">{tr(floating.error)}</p>}
      {track ? <>
        <div className="lyrics-tools">
          <Button size="sm" variant={mode === 'import' ? 'secondary' : 'ghost'} disabled={readOnly} onClick={() => switchMode('import')}><Upload size={15} />{tr("导入 .lrc")}</Button>
          <Button size="sm" variant={mode === 'search' ? 'secondary' : 'ghost'} disabled={readOnly} onClick={() => switchMode('search')}><Search size={15} />{tr("联网搜索")}</Button>
          {mode !== 'view' && saved && <Button size="sm" variant="ghost" onClick={() => switchMode('view')}>{tr("返回歌词")}</Button>}
        </div>
        {readOnly && <p className="lyrics-caption">{tr("另一标签页正在使用音乐库，此处仅可查看歌词。")}</p>}
        {error && <p className="lyrics-error" role="alert">{tr(error)}</p>}
        {mode === 'import' && <div className="lyrics-import">
          <p className="lyrics-caption">{tr("选择这首歌的 .lrc 文件，在本机读取。确认预览后保存。")}</p>
          <Button variant="outline" disabled={readOnly || loading} onClick={() => input.current?.click()}><Upload size={16} />{loading ? tr("正在读取…") : tr("选择歌词文件")}</Button>
          <input ref={input} type="file" accept=".lrc" aria-label={tr("歌词文件")} hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void importFile(file); }} />
          {local && <label className="lyrics-encoding">{tr("文字编码")}<NativeSelect aria-label={tr("歌词文字编码")} value={encoding} onChange={(event) => { setEncoding(event.target.value as LyricsEncoding); stageLocal(local.bytes, local.name, event.target.value as LyricsEncoding); }}>
              <NativeSelectOption value="utf-8">UTF-8</NativeSelectOption><NativeSelectOption value="gb18030">GB18030 / GBK</NativeSelectOption>
              <NativeSelectOption value="utf-16le">UTF-16 LE</NativeSelectOption><NativeSelectOption value="utf-16be">UTF-16 BE</NativeSelectOption>
            </NativeSelect><span>{tr("出现乱码时可切换")}</span>
          </label>}
        </div>}
        {mode === 'search' && !draft && <>
          <form className="lyrics-search-form" onSubmit={(event) => { event.preventDefault(); void search(); }}>
            <label>{tr("歌曲名称")}<Input aria-label={tr("歌词搜索歌曲名称")} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label>
            <label>{tr("歌手（可选）")}<Input aria-label={tr("歌词搜索歌手")} value={artist} maxLength={200} onChange={(event) => setArtist(event.target.value)} /></label>
            <p className="lyrics-caption">{tr("搜索时会向")}<a href="https://lrclib.net" target="_blank" rel="noreferrer">LRCLIB</a> {tr("发送填写的歌名和歌手，不上传音乐文件。")}</p>
            <div className="lyrics-actions"><Button type="submit" disabled={!title.trim() || loading || readOnly}>{loading ? tr("搜索中…") : tr("搜索歌词")}</Button>{loading && <Button type="button" variant="ghost" onClick={cancel}>{tr("取消搜索")}</Button>}</div>
          </form>
          <div className="lyrics-results" aria-label={tr("歌词搜索结果")} aria-busy={loading}>
            {searched && !results.length && <p className="lyrics-caption" role="status">{tr("没有找到歌词。试试简化歌名、填写歌手，或导入本地 .lrc 文件。")}</p>}
            {results.length > 0 && <p className="lyrics-caption">{tr("同步歌词优先，同类结果按时长接近程度排列。请预览确认版本。")}</p>}
            {results.map((result) => <button key={result.id} className="lyrics-result" onClick={() => {
              try { setDraft(candidateLyrics(result)); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取这份歌词。'); }
            }}><strong>{result.title}</strong><span>{result.artist || tr("未知歌手")} · {result.album || tr("未知专辑")}</span>
              <span>{result.syncedLyrics ? tr("同步歌词") : result.plainLyrics ? tr("纯文本") : tr("纯音乐")} · {result.duration === null ? tr("时长未知") : formatTime(result.duration)}{track.duration > 0 && result.duration !== null ? tr(message(" · 与当前歌曲相差 {0} 秒", {0:Math.abs(result.duration - track.duration).toFixed(1)})) : ''}</span><em>{tr("预览歌词 →")}</em></button>)}
          </div>
        </>}
        {draft && <>
          <div className="lyrics-draft-heading"><strong>{tr("预览 ·")}{kindLabel(draft)}</strong><p>{draft.label}</p>
            {draft.parsed.warnings.map((warning) => <p className="lyrics-warning" key={tr(warning)}>{tr(warning)}</p>)}
            {draft.parsed.offsetMs !== 0 && <p>{tr("LRC 内置偏移：")}{draft.parsed.offsetMs} {tr("毫秒（正值提前）")}</p>}
          </div>
          <LyricsView key={`${draft.updatedAt}-${encoding}`} record={draft} positionMs={0} preview />
          <div className="lyrics-save"><p className="lyrics-caption">{saved ? tr("确认后将替换这首歌已有的歌词，校时恢复为 0。") : tr("确认后随这首音乐保存在当前浏览器。")}</p>
            <div className="lyrics-actions"><Button disabled={readOnly} onClick={() => { save(draft); setDraft(null); setLocal(null); setMode('view'); }}>{tr("使用这份歌词")}</Button><Button variant="ghost" onClick={() => { setDraft(null); setError(''); }}>{mode === 'search' ? tr("返回搜索结果") : tr("取消预览")}</Button></div>
          </div>
        </>}
        {mode === 'view' && (saved ? <>
          <div className="lyrics-source"><span>{kindLabel(saved)} · {saved.source === 'local' ? tr("本地导入") : <a href="https://lrclib.net" target="_blank" rel="noreferrer">LRCLIB</a>}</span><small title={saved.label}>{saved.label}</small></div>
          <LyricsView key={saved.updatedAt} record={saved} positionMs={positionMs} />
          <div className="lyrics-adjust">
            {saved.parsed.kind === 'synced' && <><p>{tr("歌词校时")}<strong>{saved.adjustmentMs === 0 ? tr("未调整") : tr(message("{0} {1} 秒", {0:saved.adjustmentMs > 0 ? tr("延后") : tr("提前"),1:Math.abs(saved.adjustmentMs / 1000).toFixed(1)}))}</strong></p>
              <div className="lyrics-actions"><Button size="sm" variant="secondary" disabled={readOnly || saved.adjustmentMs <= -60_000} onClick={() => save({ ...saved, adjustmentMs: saved.adjustmentMs - 500 })}>{tr("提前 0.5 秒")}</Button><Button size="sm" variant="secondary" disabled={readOnly || saved.adjustmentMs >= 60_000} onClick={() => save({ ...saved, adjustmentMs: saved.adjustmentMs + 500 })}>{tr("延后 0.5 秒")}</Button><Button size="sm" variant="ghost" disabled={readOnly || saved.adjustmentMs === 0} onClick={() => save({ ...saved, adjustmentMs: 0 })}>{tr("重置校时")}</Button></div></>}
            {confirmRemove ? <div className="lyrics-remove"><span>{tr("移除这首歌已保存的歌词？")}</span><Button size="sm" variant="destructive" disabled={readOnly} onClick={() => { save(undefined); setConfirmRemove(false); }}>{tr("确认移除歌词")}</Button><Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>{tr("取消")}</Button></div> : <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => setConfirmRemove(true)}>{tr("移除歌词")}</Button>}
          </div>
        </> : <div className="lyrics-empty"><FileText size={36} /><h3>{tr("给这首歌添上歌词")}</h3><p>{tr("导入本地 .lrc，或联网搜索一份歌词。")}<br />{tr("有时间标记的歌词会随播放逐行高亮。")}</p></div>)}
      </> : <div className="lyrics-empty"><FileText size={36} /><p>{tr("从音乐库选择一首歌，再为它添加歌词。")}</p></div>}
    </SheetContent>
  </Sheet>;
}
