import { parseMusicFile } from './metadata-reader.ts';
import { coverStorage } from './storage.ts';
import type { Track } from './model.ts';
export type CoverRecord = {
  blob?: Blob;
  title?: string;
  artist?: string;
  album?: string;
  source: 'embedded' | 'upload' | 'online';
  label?: string;
};
export type CoverCandidate = { id: string; title: string; artist: string };
export const coverKey = (track: Track, custom = false) =>
  custom
    ? `custom:${track.id}`
    : `embedded:${track.id}:${track.size || 0}:${track.modified || 0}`;
export async function normalizeCover(blob: Blob): Promise<Blob> {
  if (!blob.size || blob.size > 10 * 1024 * 1024)
    throw new Error('请选择不超过 10 MB 的图片。');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type))
    throw new Error('支持 JPG、PNG 和 WebP 图片。');
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error('图片像素过大，请缩小后重试。');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法处理图片。');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('无法保存图片。'))),
        'image/webp',
        0.9,
      ),
    );
  } finally {
    bitmap.close();
  }
}
export async function embeddedCover(
  track: Track,
  resolve: () => Promise<File>,
): Promise<CoverRecord> {
  const key = coverKey(track);
  const saved = await coverStorage<CoverRecord>(key, 'read');
  if (saved) return saved;
  const file = await resolve();
  const metadata = await parseMusicFile(file, track.id);
  const pictureList = metadata.common.picture;
  const selectCover = (pictures: typeof pictureList) =>
    pictures?.find((p) => /front/i.test(p.type || '')) || pictures?.[0];
  const picture = selectCover(metadata.common.picture);
  const record: CoverRecord = {
    source: 'embedded',
    title: metadata.common.title,
    artist: metadata.common.artist,
    album: metadata.common.album,
  };
  if (picture) {
    try {
      record.blob = await normalizeCover(
        new Blob([new Uint8Array(picture.data)], { type: picture.format }),
      );
    } catch {
      /* Invalid artwork must not block playback. */
    }
  }
  await coverStorage(key, 'write', record);
  return record;
}
