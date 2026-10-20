import { isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { open as openFile, readDir, stat } from '@tauri-apps/plugin-fs';
import { supportedExtension, type ScannedFile } from '../music/model.ts';

export type DesktopFolder = { path: string; name: string };

export function scopedMusicPath(rootPath: string, relativePath: string) {
  if (!rootPath.startsWith('/') || !relativePath || relativePath.includes('\0'))
    return null;
  const parts = relativePath.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  return `${rootPath.replace(/\/+$/, '')}/${parts.join('/')}`;
}

export async function pickDesktopFolder(): Promise<DesktopFolder | null> {
  if (!isTauri()) throw new Error('系统文件夹选择器仅在桌面版中可用。');
  const selected = await open({
    title: '选择音乐文件夹',
    defaultPath: await homeDir(),
    directory: true,
    recursive: true,
    multiple: false,
    fileAccessMode: 'scoped',
  });
  if (typeof selected !== 'string') return null;
  const info = await stat(selected);
  if (!info.isDirectory) throw new Error('所选位置不是文件夹。');
  const name = selected.replace(/\/+$/, '').split('/').at(-1);
  if (!name) throw new Error('无法读取所选文件夹名称。');
  return { path: selected, name };
}

export async function desktopFolderPermission(folder: DesktopFolder) {
  try {
    return (await stat(folder.path)).isDirectory ? 'granted' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export async function scanDesktopFolder(
  folder: DesktopFolder,
  signal: AbortSignal,
  onProgress: (count: number) => void,
): Promise<ScannedFile[]> {
  const files: ScannedFile[] = [];
  async function walk(path: string, prefix: string) {
    signal.throwIfAborted();
    const entries = await readDir(path);
    for (const entry of entries) {
      signal.throwIfAborted();
      if (!entry.name || entry.name === '.' || entry.name === '..' || entry.name.includes('/'))
        continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const childPath = scopedMusicPath(folder.path, relative);
      if (!childPath || entry.isSymlink) continue;
      if (entry.isDirectory) {
        await walk(childPath, relative);
      } else if (entry.isFile && supportedExtension(entry.name)) {
        const info = await stat(childPath);
        if (!info.isFile || info.isSymlink) continue;
        files.push({
          path: relative,
          name: entry.name,
          size: info.size,
          modified: info.mtime?.getTime() || 0,
        });
        if (files.length % 50 === 0) {
          onProgress(files.length);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }
  }
  await walk(folder.path, '');
  signal.throwIfAborted();
  onProgress(files.length);
  return files;
}

export async function resolveDesktopFile(
  folder: DesktopFolder,
  relativePath: string,
  signal?: AbortSignal,
): Promise<File> {
  signal?.throwIfAborted();
  const path = scopedMusicPath(folder.path, relativePath);
  if (!path) throw new Error('音乐文件路径无效，请刷新音乐库。');
  const info = await stat(path);
  if (!info.isFile || info.isSymlink)
    throw new Error('音乐文件暂不可用，请重新关联文件夹并刷新音乐库。');
  if (info.size > 512 * 1024 * 1024)
    throw new Error('此桌面版本暂不支持读取超过 512 MB 的单个音乐文件。');
  const chunks = await readDesktopFileChunks(await openFile(path, { read: true }), info.size, signal);
  const name = relativePath.split('/').at(-1) || 'music';
  return new File(chunks, name, { lastModified: info.mtime?.getTime() || 0 });
}

export async function readDesktopFileChunks(
  handle: { read(buffer: Uint8Array): Promise<number | null>; close(): Promise<void> },
  size: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>[]> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    while (total < size) {
      signal?.throwIfAborted();
      const buffer: Uint8Array<ArrayBuffer> = new Uint8Array(Math.min(1024 * 1024, size - total));
      const count = await handle.read(buffer);
      if (count === null || count === 0) throw new Error('音乐文件在读取期间发生变化，请刷新音乐库。');
      chunks.push(buffer.slice(0, count));
      total += count;
    }
    signal?.throwIfAborted();
    return chunks;
  } finally {
    await handle.close();
  }
}
