import {
  supportedExtension,
  type DirectoryHandle,
  type ScannedFile,
  type Track,
  type Root,
} from './model';
import { resolveDesktopFile } from '../desktop/folders';
export const isDesktopApp = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const canBindDirectory = () =>
  isDesktopApp() ||
  (typeof window !== 'undefined' && 'showDirectoryPicker' in window);
export async function pickDirectory(): Promise<DirectoryHandle> {
  return (
    window as unknown as {
      showDirectoryPicker: (opts: object) => Promise<DirectoryHandle>;
    }
  ).showDirectoryPicker({ id: 'ziyou-music', mode: 'read' });
}
export async function directoryPermission(
  handle: DirectoryHandle,
  request = false,
): Promise<PermissionState> {
  if (request) return handle.requestPermission({ mode: 'read' });
  return handle.queryPermission({ mode: 'read' });
}
export async function scanDirectory(
  handle: DirectoryHandle,
  signal: AbortSignal,
  onProgress: (n: number) => void,
): Promise<ScannedFile[]> {
  const files: ScannedFile[] = [];
  async function walk(dir: DirectoryHandle, prefix: string) {
    for await (const [name, entry] of dir.entries()) {
      signal.throwIfAborted();
      if (entry.kind === 'directory')
        await walk(entry as DirectoryHandle, prefix + name + '/');
      else if (supportedExtension(name)) {
        const file = await (entry as FileSystemFileHandle).getFile();
        files.push({
          path: prefix + name,
          name,
          size: file.size,
          modified: file.lastModified,
        });
        if (files.length % 50 === 0) {
          onProgress(files.length);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }
  }
  await walk(handle, '');
  signal.throwIfAborted();
  onProgress(files.length);
  return files;
}
export async function resolveTrackFile(
  track: Track,
  roots: Root[],
  temporary: Map<string, File>,
): Promise<File> {
  if (!track.rootId) {
    const file = temporary.get(track.id);
    if (!file)
      throw new Error(
        '这是临时导入的文件。请重新选择文件，或绑定所在文件夹以便下次恢复。',
      );
    return file;
  }
  const root = roots.find((r) => r.id === track.rootId);
  if (root?.nativePath) {
    return resolveDesktopFile(
      { path: root.nativePath, name: root.name },
      track.path || '',
    );
  }
  if (!root?.handle) throw new Error('请在“音乐文件夹”中重新关联目录。');
  if ((await directoryPermission(root.handle)) !== 'granted')
    throw new Error('请先在“音乐文件夹”中重新授权该目录。');
  const parts = (track.path || '').split('/');
  if (parts.some((p) => !p || p === '.' || p === '..'))
    throw new Error('文件路径无效，请刷新音乐库。');
  let dir: FileSystemDirectoryHandle = root.handle;
  try {
    for (const part of parts.slice(0, -1))
      dir = await dir.getDirectoryHandle(part);
    return await (await dir.getFileHandle(parts.at(-1)!)).getFile();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotFoundError')
      throw new Error('原文件已移动或暂时不可用。请连接原目录并刷新音乐库。');
    throw e;
  }
}
