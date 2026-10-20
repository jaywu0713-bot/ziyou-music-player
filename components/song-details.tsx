'use client';
import { number as localizedNumber, message } from '@/lib/i18n/core';
import { useTranslation } from '@/lib/i18n/react';
import { useState } from 'react';
import { bitDepth, fileSize, type SongMetadata } from '@/lib/music/metadata';
import type { Track } from '@/lib/music/model';
import { effectiveCredits } from '@/lib/music/identification';
function People({ title, names }: { title: string; names: string[] }) {
  const tr = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (!names.length) return null;
  return (
    <div className="song-detail-row">
      <dt>{title}</dt>
      <dd>
        {(expanded ? names : names.slice(0, 3)).map((name, i) => (
          <div key={i}>{name}</div>
        ))}
        {names.length > 3 && (
          <button className="accent" onClick={() => setExpanded((v) => !v)}>
            {expanded ? tr("收起") : tr(message("展开全部（{0}）", {0:names.length}))}
          </button>
        )}
      </dd>
    </div>
  );
}
export function SongDetails({
  track,
  info,
  loading,
  error,
  warning,
  retry,
}: {
  track?: Track;
  info?: SongMetadata;
  loading: boolean;
  error?: string;
  warning?: string;
  retry: () => void;
}) {
  const tr = useTranslation();
  const credits = track?.identification ? effectiveCredits(track) : {artists:info?.artists || [],album:info?.album || ''};
  const duration = info?.duration || track?.duration;
  const rows = [
    [tr("文件名"), track?.name || tr("未选择")],
    [tr("大小"), fileSize(info?.size ?? track?.size)],
    [
      tr("时长"),
      duration
        ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`
        : tr("未知"),
    ],
    [
      tr("格式 / 编码"),
      info
        ? [info.container, info.codec].filter(Boolean).join(' / ') || tr("未知")
        : track
          ? tr(message("{0}（文件扩展名，待确认）", {0:track.format}))
          : tr("未知"),
    ],
    [
      tr("采样率"),
      info?.sampleRate
        ? `${localizedNumber(info.sampleRate)} Hz${info.dsd ? ` · ${info.dsd}` : ''}`
        : tr("未知"),
    ],
    [tr("位深"), info ? tr(bitDepth(info)) : tr("未知")],
    [
      tr("比特率"),
      info?.bitrate
        ? `${(info.bitrate / 1000).toFixed(0)} kbps · ${tr(info.bitrateLabel)}`
        : tr("未知"),
    ],
    [
      tr("声道"),
      info?.channels
        ? tr(message("{0} 声道{1}", {0:info.channels,1:info.channels === 1 ? tr("（单声道）") : info.channels === 2 ? tr("（双声道）") : ''}))
        : tr("未知"),
    ],
  ];
  return (
    <section className="song-details">
      {loading && <output>{tr("正在读取歌曲信息…")}</output>}
      {(error || warning) && (
        <p role="alert">
          {tr(error || warning || '')}{' '}
          <button className="accent" onClick={retry}>
            {tr("重新读取")}</button>
        </p>
      )}
      <h3>{tr("歌曲与参与者")}</h3>
      <dl>
        <div className="song-detail-row">
          <dt>{tr("歌曲名称")}</dt>
          <dd>{info?.title || track?.name || tr("未选择")}</dd>
        </div>
        {(info || track?.identification) && (
          <>
            <People title={tr("艺术家")} names={credits.artists} />
            {credits.album && <div className="song-detail-row"><dt>{tr('专辑')}</dt><dd>{credits.album}</dd></div>}
            {track?.identification && <div className="song-detail-row"><dt>{tr('资料来源')}</dt><dd>{track.identification.manual ? tr('手动编辑') : track.identification.automatic ? tr('自动识别') : tr('文件标签')}</dd></div>}
            <People title={tr("演奏者")} names={info?.performers || []} />
            <People title={tr("作曲家")} names={info?.composers || []} />
            <People title={tr("指挥")} names={info?.conductors || []} />
          </>
        )}
      </dl>
      <h3>{tr("源文件规格")}</h3>
      <dl>
        {rows.map(([label, value]) => (
          <div className="song-detail-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
