import { parseBlob } from 'music-metadata';
self.onmessage = async ({ data }: MessageEvent<File>) => {
  try {
    self.postMessage({ metadata: await parseBlob(data, { duration: true }) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : '无法读取文件信息。',
    });
  }
};
