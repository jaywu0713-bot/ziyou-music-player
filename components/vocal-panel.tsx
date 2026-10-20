import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n/react';
import { message } from '@/lib/i18n/core';
import type { Track } from '@/lib/music/model';
import type { useVocals } from '@/hooks/use-vocals';

type Vocals = ReturnType<typeof useVocals>;
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const stages: Record<string, string> = {
  upload: '准备原曲', ready: '准备处理', loading: '载入模型',
  preparing: '转换音频', download: '下载模型', separating: '分离人声',
  saving: '保存伴奏', result: '完成', error: '处理失败',
};
export function VocalPanel({
  vocals,
  track,
  onSelect,
  disabled,
  onCacheCleared,
}: {
  vocals: Vocals;
  track?: Track;
  onSelect?: (version: 'original' | 'instrumental') => void;
  disabled: boolean;
  onCacheCleared: (id?: string) => void;
}) {
  const tr = useTranslation();
  const [confirm, setConfirm] = useState<'all' | 'model' | null>(null);
  const entry = vocals.status?.entries.find(
    (entry) =>
      entry.trackId === track?.id &&
      entry.sourceSize === track?.size &&
      entry.sourceModified === track?.modified,
  );
  const job = vocals.status?.job;
  return (
    <section className="organize-track-section vocal-panel">
      <h3>{tr(track ? '人声分离' : '伴奏与模型缓存')}</h3>
      <p className="muted">
        {tr('在这台 Mac 上生成伴奏，原曲不上传、不修改。人声可能有少量残留，也可能一起去掉和声。')}
      </p>
      {!vocals.status?.modelReady && (
        <div>
          <p>
            {tr('首次使用需下载约 160 MB 的 htdemucs 模型。来源：')}
            <a
              href="https://huggingface.co/ssmall256/demucs-mlx"
              target="_blank"
              rel="noreferrer"
            >
              Demucs MLX
            </a>
            {tr('；代码及发布模型标注 MIT，署名与许可随软件保存。之后可离线处理。')}
          </p>
          <Button
            disabled={disabled || vocals.busy || !vocals.status}
            onClick={() => void vocals.download()}
          >
            {tr('下载模型并启用（160 MB）')}
          </Button>
        </div>
      )}
      {job && (
        <output>
          <span>
            {tr(stages[job.stage] || '正在处理')} · {Math.round(job.progress * 100)}
            %
          </span>
          <progress max={1} value={job.progress} aria-label={tr('人声分离进度')} />
          <Button variant="ghost" onClick={() => void vocals.cancel()}>
            {tr('取消处理')}
          </Button>
          <small>{tr('可继续播放或管理其他歌曲。')}</small>
        </output>
      )}
      {vocals.error && <p role="alert">{tr(vocals.error)}</p>}
      {track && (
        <div className="organize-track-links">
          <Button
            disabled={
              disabled ||
              vocals.busy ||
              !!track.catalog ||
              !vocals.status?.modelReady
            }
            onClick={() => void vocals.generate(track)}
          >
            {tr(entry ? '重新生成伴奏' : '生成伴奏')}
          </Button>
          {entry && (
            <>
              <span>{tr('已缓存伴奏')} · {size(entry.bytes)}</span>
              <Button
                variant={
                  track.playbackVersion === 'instrumental'
                    ? 'outline'
                    : 'default'
                }
                disabled={disabled}
                onClick={() => onSelect?.('original')}
              >
                {tr('原曲')}
              </Button>
              <Button
                variant={
                  track.playbackVersion === 'instrumental'
                    ? 'default'
                    : 'outline'
                }
                disabled={disabled}
                onClick={() => onSelect?.('instrumental')}
              >
                {tr('伴奏')}
              </Button>
              <Button
                variant="ghost"
                disabled={disabled || vocals.busy}
                onClick={async () => {
                  if (await vocals.clear(entry.key)) onCacheCleared(track.id);
                }}
              >
                {tr('删除这首伴奏缓存')}
              </Button>
            </>
          )}
        </div>
      )}
      {!track && vocals.status && (
        <>
          <p>
            {tr('伴奏缓存：')}{size(vocals.status.cacheBytes)} ·{' '}
            {vocals.status.entries.length} {tr('首')}
          </p>
          <p>{tr('模型文件：')}{size(vocals.status.modelBytes)}</p>
          <details>
            <summary>{tr('保存位置与清理说明')}</summary>
            <p>
              {tr('伴奏仅用于加快下次播放，可重新生成。清除伴奏缓存保留模型；删除模型保留已生成伴奏。')}
            </p>
            <p style={{ overflowWrap: 'anywhere' }}>
              {tr('伴奏：')}{vocals.status.cachePath}
            </p>
            <p style={{ overflowWrap: 'anywhere' }}>
              {tr('模型：')}{vocals.status.modelPath}
            </p>
          </details>
          <div className="organize-track-links">
            <Button
              variant="outline"
              disabled={disabled || vocals.busy || !vocals.status.cacheBytes}
              onClick={() => setConfirm('all')}
            >
              {tr('清除全部伴奏缓存')}
            </Button>
            <Button
              variant="ghost"
              disabled={disabled || vocals.busy || !vocals.status.modelBytes}
              onClick={() => setConfirm('model')}
            >
              {tr('删除本地模型')}
            </Button>
          </div>
          {confirm && (
            <div role="alert">
              <p>
                {confirm === 'all'
                  ? tr(message('清除 {0} 首伴奏，共 {1}？原曲和模型都会保留。', {0:vocals.status.entries.length,1:size(vocals.status.cacheBytes)}))
                  : tr(message('删除 {0} 的模型？下次生成需重新下载。', {0:size(vocals.status.modelBytes)}))}
              </p>
              <Button
                disabled={vocals.busy}
                onClick={async () => {
                  if (await vocals.clear(null, confirm === 'model')) {
                    if (confirm === 'all') onCacheCleared();
                    setConfirm(null);
                  }
                }}
              >
                {tr('确认清除')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                {tr('取消')}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
