'use client';
import { getLanguage, message } from '@/lib/i18n/core';
import { useTranslation } from '@/lib/i18n/react';

import { useEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Pause, Play, Settings2, SkipBack, SkipForward, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { Track } from '@/lib/music/model';
import { floatingLyricLines, type LyricsWindowPreferences } from '@/lib/music/lyrics-window';

export function LyricsWindow({ target, track, positionMs, preferences, settingsOpen, readOnly,
  playing, preparing, canSkip, storageError, onSettingsChange, onPreferencesChange,
  onTogglePlay, onPrevious, onNext, onReturn, onClose,
}: {
  target: HTMLElement;
  track?: Track;
  positionMs: number;
  preferences: LyricsWindowPreferences;
  settingsOpen: boolean;
  readOnly: boolean;
  playing: boolean;
  preparing: boolean;
  canSkip: boolean;
  storageError: string;
  onSettingsChange: (value: boolean) => void;
  onPreferencesChange: (preferences: LyricsWindowPreferences) => void;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onReturn: () => void;
  onClose: () => void;
}) {
  const tr = useTranslation();
  const language = getLanguage();
  const record = track?.lyrics;
  const toggle = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(settingsOpen);
  const text = useRef<HTMLDivElement>(null);
  const trackName = track?.name;
  const lines = record?.parsed.kind === 'synced' ? floatingLyricLines(record, positionMs) : null;
  useEffect(() => {
    const doc = text.current?.ownerDocument;
    if (doc) doc.documentElement.lang = language;
    if (doc) doc.title = trackName ? tr(message("{0} · 自用歌词", {0:trackName})) : tr("自用 · 悬浮歌词");
  }, [trackName, language, tr]);
  useEffect(() => {
    if (wasOpen.current && !settingsOpen && target.contains(target.ownerDocument.activeElement)) {
      toggle.current?.focus();
    }
    wasOpen.current = settingsOpen;
  }, [settingsOpen, target]);
  useEffect(() => {
    // Reset only on a changed line/record, preserving manual scroll while paused.
    text.current?.scrollTo({ top: 0 });
  }, [lines?.active, track?.id, record?.rawText]);

  const change = (patch: Partial<LyricsWindowPreferences>) => onPreferencesChange({ ...preferences, ...patch });
  return createPortal(
    <section className={`lyrics-window${settingsOpen ? ' preferences-open' : ''}`}
      aria-label={tr("悬浮歌词")} style={{
        '--lyrics-window-size': `${preferences.fontSize}px`,
        '--lyrics-window-font': preferences.fontFamily === 'serif'
          ? "'Songti SC',SimSun,serif" : "Arial,'PingFang SC','Microsoft YaHei',sans-serif",
      } as CSSProperties}>
      <div className="lyrics-window-preference-switch">
        <label htmlFor="floating-lyrics-preferences"><Settings2 size={16} />{tr("偏好设置")}</label>
        <Switch ref={toggle} id="floating-lyrics-preferences" checked={settingsOpen}
          onCheckedChange={onSettingsChange} aria-controls="floating-lyrics-settings" />
      </div>
      <div className="lyrics-window-text" ref={text}>
        {lines ? <div className="lyrics-window-lines">
          <div className={`lyrics-window-current${lines.active >= 0 ? ' is-active' : ''}`} aria-current={lines.active >= 0 ? 'true' : undefined}>
            {lines.current.map((line, index) => <p key={index}>{line || '♪'}</p>)}
          </div>
          {preferences.lines === 2 && lines.next.length > 0 && <div className="lyrics-window-next">
            {lines.next.map((line, index) => <p key={index}>{line || '♪'}</p>)}
          </div>}
        </div> : record?.parsed.kind === 'plain' ? <div className="lyrics-window-plain">
          <p className="lyrics-window-note">{tr("纯文本歌词 · 无时间标记")}</p>
          <p>{record.parsed.plainText}</p>
        </div> : <div className="lyrics-window-empty">
          <p>{record?.parsed.kind === 'instrumental' ? tr("♪ 纯音乐") : track ? tr("暂无歌词") : tr("还没有正在播放的音乐")}</p>
          {track && <span>{track.name}</span>}
        </div>}
      </div>
      {settingsOpen && <div className="lyrics-window-settings" id="floating-lyrics-settings">
        <p className="lyrics-window-song">{track?.name || tr("自用")}</p>
        <div className="lyrics-window-fields">
          <div className="lyrics-window-font-size">
            <span>{tr("字号")}<output>{preferences.fontSize} px</output></span>
            <Slider aria-label={tr("悬浮歌词字号")} min={18} max={48} step={1} value={[preferences.fontSize]}
              disabled={readOnly} onValueChange={(value) => change({ fontSize: Array.isArray(value) ? value[0] : value })} />
          </div>
          <label htmlFor="floating-lyrics-font">{tr("字体")}<NativeSelect id="floating-lyrics-font" aria-label={tr("悬浮歌词字体")} value={preferences.fontFamily} disabled={readOnly}
            onChange={(event) => change({ fontFamily: event.target.value as LyricsWindowPreferences['fontFamily'] })}>
            <NativeSelectOption value="sans">{tr("无衬线")}</NativeSelectOption><NativeSelectOption value="serif">{tr("宋体")}</NativeSelectOption>
          </NativeSelect></label>
          <label htmlFor="floating-lyrics-lines">{tr("显示")}<NativeSelect id="floating-lyrics-lines" aria-label={tr("悬浮歌词显示行数")} value={preferences.lines} disabled={readOnly}
            onChange={(event) => change({ lines: Number(event.target.value) as 1 | 2 })}>
            <NativeSelectOption value={2}>{tr("当前句＋下一句")}</NativeSelectOption><NativeSelectOption value={1}>{tr("只显示当前句")}</NativeSelectOption>
          </NativeSelect></label>
        </div>
        {readOnly && <p className="lyrics-window-note">{tr("当前页面仅可查看，偏好暂不能修改。")}</p>}
        {storageError && <p className="lyrics-window-save-error" role="alert">{tr(storageError)}</p>}
        <div className="lyrics-window-controls">
          <Button size="icon-sm" variant="ghost" aria-label={tr("上一首")} disabled={!canSkip || readOnly} onClick={onPrevious}><SkipBack /></Button>
          <Button size="icon-sm" aria-label={preparing ? tr("取消准备") : playing ? tr("暂停") : tr("播放")} disabled={!track || readOnly} onClick={onTogglePlay}>
            {playing ? <Pause /> : <Play />}
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={tr("下一首")} disabled={!canSkip || readOnly} onClick={onNext}><SkipForward /></Button>
          <Button size="sm" variant="ghost" className="lyrics-window-return" onClick={onReturn}>{tr("回到播放器")}</Button>
          <Button size="icon-sm" variant="ghost" aria-label={tr("关闭歌词小窗口")} onClick={onClose}><X /></Button>
        </div>
      </div>}
    </section>, target,
  );
}
