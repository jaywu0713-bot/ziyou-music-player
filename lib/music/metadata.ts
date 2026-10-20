import type { IAudioMetadata } from 'music-metadata';
export type SongMetadata = {
  version: 1 | 2 | 3;
  size: number;
  modified: number;
  title?: string;
  discNumber?: number;
  trackNumber?: number;
  artists: string[];
  album?: string;
  albumArtists?: string[];
  performers: string[];
  composers: string[];
  conductors: string[];
  container?: string;
  codec?: string;
  duration?: number;
  sampleRate?: number;
  bits?: number;
  bitrate?: number;
  bitrateLabel: string;
  channels?: number;
  dsd?: string;
  lossy: boolean;
};
const names = (values: unknown): string[] => [
  ...new Set(
    (Array.isArray(values) ? values : [values])
      .filter((v): v is string => typeof v === 'string' && !!v.trim())
      .map((v) => v.trim()),
  ),
];
const positive = (value?: number) =>
  value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : undefined;
export function songMetadata(
  metadata: IAudioMetadata,
  file: { size: number; lastModified: number },
): SongMetadata {
  const { common: c, format: f } = metadata;
  const dsd = /DSD|DSF|DSDIFF/i.test(`${f.codec} ${f.container}`);
  const rate = positive(f.sampleRate);
  const multiplier = rate ? rate / 44100 : 0;
  const performers = names(c['performer:instrument']);
  for (const tags of Object.values(metadata.native))
    for (const tag of tags) {
      if (/^(PERFORMER|TXXX:PERFORMER)$/i.test(tag.id))
        performers.push(...names(tag.value));
    }
  return {
    version: 3,
    size: file.size,
    modified: file.lastModified,
    title: c.title,
    discNumber: Number.isInteger(c.disk?.no) && (c.disk.no || 0) > 0 ? c.disk.no! : undefined,
    trackNumber: Number.isInteger(c.track?.no) && (c.track.no || 0) > 0 ? c.track.no! : undefined,
    artists: names(c.artists?.length ? c.artists : c.artist),
    album: typeof c.album === 'string' ? c.album.trim() || undefined : undefined,
    albumArtists: names(c.albumartist),
    performers: names(performers),
    composers: names(c.composer),
    conductors: names(c.conductor),
    container: f.container,
    codec: f.codec,
    duration: positive(f.duration),
    sampleRate: rate,
    bits: positive(f.bitsPerSample),
    bitrate: positive(f.bitrate),
    bitrateLabel: f.codecProfile === 'CBR' ? '固定' : '解析值（可能为平均）',
    channels: positive(f.numberOfChannels),
    dsd: dsd
      ? [64, 128, 256, 512, 1024].includes(multiplier)
        ? `DSD${multiplier}`
        : 'DSD'
      : undefined,
    lossy: f.lossless === false,
  };
}
export function bitDepth(info: SongMetadata) {
  return info.dsd
    ? 'DSD 1-bit（非 PCM 位深）'
    : info.lossy
      ? '不适用（有损编码）'
      : info.bits
        ? `${info.bits} bit`
        : '未知';
}
export function fileSize(bytes?: number) {
  return bytes === undefined
    ? '未知'
    : bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(2)} MiB`
      : `${(bytes / 1024).toFixed(1)} KiB`;
}
