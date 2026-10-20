import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { publicAssetPath } from '../hosting.ts';
export type AudioInfo = {
  duration: number;
  channels: number;
  sampleRate: number;
  codec: string;
  format: string;
};
export type PreparedDecoder = {
  info: AudioInfo;
  chunk: (start: number, length: number, rate: number) => Promise<Float32Array>;
  close: () => void;
};
let wasmURL: Promise<string> | undefined;
async function getWasmURL(): Promise<string> {
  if (!wasmURL)
    wasmURL = (async () => {
      const response = await fetch(publicAssetPath('/decoder/manifest.json'));
      if (!response.ok) throw new Error('无法加载解码资源。');
      const manifest = (await response.json()) as {
        parts: string[];
        bytes: number;
      };
      const data = await Promise.all(
        manifest.parts.map(async (part) => {
          if (!/^ffmpeg-core\.wasm\.part\d+$/.test(part))
            throw new Error('解码资源清单无效。');
          const r = await fetch(publicAssetPath('/decoder/' + part));
          if (!r.ok) throw new Error('解码器下载失败，请检查网络后重试。');
          return r.arrayBuffer();
        }),
      );
      const blob = new Blob(data, { type: 'application/wasm' });
      if (blob.size !== manifest.bytes)
        throw new Error('解码资源不完整，请重新加载。');
      return URL.createObjectURL(blob);
    })().catch((e) => {
      wasmURL = undefined;
      throw e;
    });
  return wasmURL;
}
function check(signal: AbortSignal) {
  signal.throwIfAborted();
}
export async function prepareDecoder(
  file: File,
  signal: AbortSignal,
  report: (message: string) => void,
): Promise<PreparedDecoder> {
  check(signal);
  if (file.size >= 2 * 1024 * 1024 * 1024)
    throw new Error('扩展解码暂不支持 2 GB 及以上文件。原文件和分类已保留。');
  report('正在加载本地解码器…');
  const { FFmpeg, FFFSType } = await import('@ffmpeg/ffmpeg');
  check(signal);
  const ffmpeg: FFmpeg = new FFmpeg();
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      ffmpeg.terminate();
    }
    signal.removeEventListener('abort', close);
  };
  signal.addEventListener('abort', close, { once: true });
  try {
    const binaryURL = await getWasmURL();
    check(signal);
    await ffmpeg.load({
      classWorkerURL: new URL(publicAssetPath('/decoder/worker.js'), location.href).href,
      coreURL: new URL(publicAssetPath('/decoder/ffmpeg-core.js'), location.href).href,
      wasmURL: binaryURL,
    });
    check(signal);
    report('正在识别音频内容…');
    await ffmpeg.createDir('/input');
    // WORKERFS reads slices from File in the worker. Never copy a whole album into MEMFS.
    if (
      !(await ffmpeg.mount(
        FFFSType.WORKERFS,
        { blobs: [{ name: 'music', data: file }] },
        '/input',
      ))
    )
      throw new Error('当前解码器不支持分段读取，无法安全处理此文件。');
    const ret = await ffmpeg.ffprobe(
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_name,sample_rate,channels,duration:format=format_name,duration',
        '-of',
        'json',
        '/input/music',
        '-o',
        '/probe.json',
      ],
      20000,
    );
    check(signal);
    if (ret !== 0 && ret !== -1)
      throw new Error('无法识别此音频，文件可能损坏或编码暂不支持。');
    const parsed = JSON.parse(
      (await ffmpeg.readFile('/probe.json', 'utf8')) as string,
    );
    await ffmpeg.deleteFile('/probe.json');
    const stream = parsed.streams?.[0];
    if (!stream || !stream.codec_name)
      throw new Error('无法识别此音频，文件可能损坏或编码暂不支持。');
    // This core's ffprobe leaves ret at -1 on successful output; validate the JSON instead.
    let dsfDuration: number | undefined;
    let dsfRate: number | undefined;
    const header = new DataView(await file.slice(0, 80).arrayBuffer());
    if (
      header.byteLength >= 80 &&
      header.getUint32(0) === 0x44534420 &&
      header.getUint32(28) === 0x666d7420
    ) {
      const samples = Number(header.getBigUint64(64, true));
      const rate = header.getUint32(56, true);
      if (Number.isSafeInteger(samples) && samples > 0 && rate > 0) {
        dsfDuration = samples / rate;
        dsfRate = rate;
      }
    }
    const info: AudioInfo = {
      duration:
        dsfDuration ?? Number(stream?.duration || parsed.format?.duration),
      channels: Number(stream?.channels),
      sampleRate: dsfRate ?? Number(stream?.sample_rate),
      codec: stream?.codec_name || 'unknown',
      format: parsed.format?.format_name || 'unknown',
    };
    if (!Number.isFinite(info.duration) || info.duration <= 0)
      throw new Error('无法确认音频时长，暂不尝试连续解码。');
    if (
      !Number.isInteger(info.channels) ||
      info.channels < 1 ||
      info.channels > 2
    )
      throw new Error('扩展解码暂支持单声道和双声道文件。');
    return {
      info,
      close,
      async chunk(start, length, rate) {
        check(signal);
        // Decode with pre-roll so DSD filters/resamplers settle before each chunk boundary.
        const seek = Math.max(0, start - 0.25),
          trim = start - seek;
        const result = await ffmpeg.exec(
          [
            '-v',
            'error',
            '-ss',
            seek.toFixed(6),
            '-i',
            '/input/music',
            '-ss',
            trim.toFixed(6),
            '-t',
            length.toFixed(6),
            '-map',
            '0:a:0',
            '-vn',
            '-sn',
            '-dn',
            '-ar',
            String(rate),
            '-acodec',
            'pcm_f32le',
            '-f',
            'f32le',
            '/chunk.pcm',
          ],
          30000,
        );
        check(signal);
        if (result !== 0)
          throw new Error('解码失败或处理超时。请换一首音乐，原文件不受影响。');
        const bytes = await ffmpeg.readFile('/chunk.pcm');
        await ffmpeg.deleteFile('/chunk.pcm');
        if (
          !(bytes instanceof Uint8Array) ||
          bytes.byteLength % (4 * info.channels) !== 0
        )
          throw new Error('解码结果不完整。');
        // Own the exact-sized buffer; it will be transferred to AudioWorklet.
        return new Float32Array(bytes.slice().buffer);
      },
    };
  } catch (e) {
    close();
    if (signal.aborted) throw new DOMException('取消播放', 'AbortError');
    throw e;
  }
}
