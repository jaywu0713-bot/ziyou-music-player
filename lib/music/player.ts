import {
  connectPlayerAudioGraph,
  connectVisualizationAnalyzer,
  type VisualizationFrame,
} from './visualization.ts';
import type { Track } from './model';
import { prepareDecoder, type AudioInfo } from './decoder.ts';
import { publicAssetPath } from '../hosting.ts';
export type PlayerStatus =
  | 'idle'
  | 'preparing'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'ended'
  | 'error';
export type PlayerState = {
  status: PlayerStatus;
  position: number;
  duration: number;
  message: string;
  path: string;
  info?: AudioInfo;
  outputRate?: number;
  startupMs?: number;
  decodedSeconds?: number;
  decodeMs?: number;
  bufferSeconds?: number;
};
export const idlePlayer: PlayerState = {
  status: 'idle',
  position: 0,
  duration: 0,
  message: '',
  path: '',
};
export class PlaybackDeck {
  private audio: HTMLAudioElement;
  private mediaSource?: MediaElementAudioSourceNode;
  private sharedContext: AudioContext;
  readonly output: GainNode;
  prepared = false;
  snapshot() {
    return { ...this.state };
  }
  positionNow() {
    return this.nativeURL ? this.audio.currentTime : this.state.position;
  }
  private job?: AbortController;
  private nativeURL?: string;
  private context?: AudioContext;
  private worklet?: AudioWorkletNode;
  private gain?: GainNode;
  private decoderClose?: () => void;
  private wantsPlay = false;
  private volume = 0.7;
  private state = { ...idlePlayer };
  private loadedTrack?: Track;
  private loadedFile?: File;
  private streamStart = 0;
  private buffered = 0;
  private bufferWaiter?: () => void;
  private onUpdate: (state: PlayerState) => void;
  private onEnd: () => void;
  constructor(
    update: (state: PlayerState) => void,
    ended: () => void,
    context: AudioContext,
  ) {
    this.sharedContext = context;
    this.output = context.createGain();
    this.output.connect(context.destination);
    this.onUpdate = update;
    this.onEnd = ended;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.ontimeupdate = () => {
      if (this.nativeURL) this.emit({ position: this.audio.currentTime });
    };
    this.audio.onended = () => {
      if (this.nativeURL) {
        this.wantsPlay = false;
        this.emit({ status: 'ended' });
        this.onEnd();
      }
    };
    this.audio.onwaiting = () => {
      if (this.nativeURL && this.wantsPlay && this.state.status !== 'preparing')
        this.emit({ status: 'buffering', message: '等待音频缓冲…' });
    };
    this.audio.onplaying = () => {
      if (this.nativeURL) this.emit({ status: 'playing', message: '' });
    };
    this.audio.onerror = () => {
      if (this.loadedTrack?.catalog && this.state.status !== 'preparing')
        this.fail(new Error('在线串流中断，请检查网络后重新播放。'));
      if (
        this.nativeURL &&
        this.state.path === '浏览器原生播放' &&
        this.state.status !== 'preparing'
      )
        this.fail(new Error('原生播放中断。请重新播放以尝试本地解码。'));
    };
  }
  private emit(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.onUpdate({ ...this.state });
  }
  private fail(e: unknown) {
    this.prepared = false;
    this.wantsPlay = false;
    this.emit({
      status: 'error',
      message: e instanceof Error ? e.message : '播放失败，请重试。',
    });
  }
  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    this.output.gain.value = this.volume;
  }
  private clear() {
    this.prepared = false;
    this.job?.abort();
    this.job = undefined;
    this.decoderClose?.();
    this.decoderClose = undefined;
    this.bufferWaiter?.();
    this.bufferWaiter = undefined;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.nativeURL?.startsWith('blob:'))
      URL.revokeObjectURL(this.nativeURL);
    this.nativeURL = undefined;
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
      this.worklet.port.close();
      this.worklet = undefined;
    }
    this.gain?.disconnect();
    this.gain = undefined;
    if (this.context) {
      this.context = undefined;
    }
  }
  stop() {
    this.clear();
    this.wantsPlay = false;
    this.loadedFile = undefined;
    this.loadedTrack = undefined;
    this.state = { ...idlePlayer };
    this.onUpdate({ ...this.state });
  }
  cancel() {
    this.clear();
    this.wantsPlay = false;
    this.loadedFile = undefined;
    this.emit({ status: 'paused', message: '已取消准备' });
  }
  destroy() {
    this.clear();
    this.output.disconnect();
    this.mediaSource?.disconnect();
    this.audio.ontimeupdate = null;
    this.audio.onended = null;
    this.audio.onerror = null;
  }
  async load(
    track: Track,
    resolve: () => Promise<File>,
    start = 0,
    autoplay = true,
  ) {
    this.clear();
    this.loadedTrack = track;
    this.loadedFile = undefined;
    this.wantsPlay = autoplay;
    this.state = {
      ...idlePlayer,
      duration: track.duration,
      position: start,
      status: 'preparing',
      message: '正在读取音乐…',
    };
    this.onUpdate({ ...this.state });
    const job = new AbortController();
    this.job = job;
    const began = performance.now();
    // Create/resume a context within the user's gesture, before file permissions or decoder fetches.
    const context = this.sharedContext;
    this.context = context;
    if (autoplay) void context.resume().catch(() => {});
    try {
      if (track.catalog) {
        await this.loadSourceUrl(track.catalog.streamUrl, start, job.signal);
        job.signal.throwIfAborted();
        this.emit({
          path: 'Jamendo · 在线串流',
          outputRate: context.sampleRate,
          startupMs: performance.now() - began,
        });
        this.prepared = true;
        if (!this.mediaSource) {
          this.mediaSource = context.createMediaElementSource(this.audio);
          this.mediaSource.connect(this.output);
        }
        if (this.wantsPlay) await this.audio.play();
        else this.emit({ status: 'paused' });
        return;
      }
      const file = await resolve();
      job.signal.throwIfAborted();
      this.loadedFile = file;
      const signature = new TextDecoder().decode(
        await file.slice(0, 12).arrayBuffer(),
      );
      job.signal.throwIfAborted();
      const knownExtended =
        signature.startsWith('DSD ') ||
        signature.startsWith('FRM8') ||
        signature.startsWith('MAC ');
      if (!knownExtended) {
        try {
          await this.loadNative(file, start, job.signal);
          job.signal.throwIfAborted();
          this.emit({
            path: '浏览器原生播放',
            outputRate: context.sampleRate,
            startupMs: performance.now() - began,
          });
          this.prepared = true;
          if (!this.mediaSource) {
            this.mediaSource = context.createMediaElementSource(this.audio);
            this.mediaSource.connect(this.output);
          }
          if (this.wantsPlay) await this.audio.play();
          else this.emit({ status: 'paused' });
          return;
        } catch (e) {
          job.signal.throwIfAborted();
          if (e instanceof DOMException && e.name === 'NotAllowedError') {
            this.emit({
              status: 'paused',
              message: '请再次点击播放以允许浏览器发声。',
            });
            return;
          }
          this.audio.pause();
          this.audio.removeAttribute('src');
          this.audio.load();
          if (this.nativeURL) URL.revokeObjectURL(this.nativeURL);
          this.nativeURL = undefined;
        }
      }
      await this.loadExtended(file, start, job.signal, began, context);
    } catch (e) {
      if (!job.signal.aborted) {
        this.clear();
        this.fail(e);
      }
    }
  }
  private loadNative(file: File, start: number, signal: AbortSignal) {
    return this.loadSourceUrl(URL.createObjectURL(file), start, signal);
  }
  private loadSourceUrl(url: string, start: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const a = this.audio;
      this.nativeURL = url;
      const done = (error?: Error) => {
        clearTimeout(timeout);
        a.removeEventListener('loadedmetadata', loaded);
        a.removeEventListener('canplay', playable);
        a.removeEventListener('error', errorEvent);
        signal.removeEventListener('abort', aborted);
        if (error) reject(error);
        else resolve();
      };
      const loaded = () => {
        if (!Number.isFinite(a.duration) || a.duration <= 0) {
          done(new Error('未知时长'));
          return;
        }
        a.currentTime = Math.min(start, Math.max(0, a.duration - 0.01));
        this.emit({ duration: a.duration, position: a.currentTime });
        if (a.readyState >= 3) done();
      };
      const playable = () => {
        if (Number.isFinite(a.duration) && a.duration > 0) done();
      };
      const errorEvent = () => done(new Error('原生解码不可用'));
      const aborted = () => done(new DOMException('取消', 'AbortError'));
      const timeout = setTimeout(() => done(new Error('原生解码超时')), 12000);
      a.addEventListener('loadedmetadata', loaded);
      a.addEventListener('canplay', playable);
      a.addEventListener('error', errorEvent);
      signal.addEventListener('abort', aborted, { once: true });
      a.crossOrigin = 'anonymous';
      a.src = url;
      a.volume = 1;
      a.load();
    });
  }
  private async loadExtended(
    file: File,
    start: number,
    signal: AbortSignal,
    began: number,
    context: AudioContext,
  ) {
    const decoder = await prepareDecoder(file, signal, (message) => {
      if (!signal.aborted) this.emit({ message });
    });
    signal.throwIfAborted();
    this.decoderClose = decoder.close;
    const { info } = decoder;
    const rate = context.sampleRate;
    this.emit({
      duration: info.duration,
      info,
      outputRate: rate,
      path: info.codec.startsWith('dsd')
        ? 'DSD → PCM · 本地解码'
        : 'PCM · 本地扩展解码',
      message: '正在准备音频缓冲…',
    });
    await context.audioWorklet.addModule(publicAssetPath('/decoder/pcm-worklet.js'));
    signal.throwIfAborted();
    const node = new AudioWorkletNode(context, 'ziyou-pcm', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [info.channels],
    });
    this.worklet = node;
    const gain = context.createGain();
    this.gain = gain;
    gain.gain.value = 1;
    node.connect(gain).connect(this.output);
    this.streamStart = Math.min(start, Math.max(0, info.duration - 0.01));
    this.buffered = 0;
    node.port.onmessage = ({ data }) => {
      if (signal.aborted) return;
      if (data.type === 'status') {
        this.buffered = data.buffered / rate;
        this.emit({
          position: this.streamStart + data.played / rate,
          bufferSeconds: this.buffered,
        });
        if (this.wantsPlay)
          this.emit({
            status: data.underrun ? 'buffering' : 'playing',
            message: data.underrun ? '正在补充音频缓冲…' : '',
          });
        this.bufferWaiter?.();
        this.bufferWaiter = undefined;
      }
      if (data.type === 'ended') {
        this.wantsPlay = false;
        this.emit({
          position: Math.min(
            info.duration,
            this.streamStart + data.played / rate,
          ),
          status: 'ended',
        });
        this.onEnd();
      }
    };
    let offset = this.streamStart,
      first = true,
      totalMs = 0,
      totalSeconds = 0;
    while (offset < info.duration - 0.000001) {
      signal.throwIfAborted();
      // At most three 2-second chunks queued, plus one in flight. No whole-file PCM allocation.
      while (this.buffered >= 4) {
        await new Promise<void>((r) => {
          this.bufferWaiter = r;
        });
        signal.throwIfAborted();
      }
      const length = Math.min(2, info.duration - offset);
      const t = performance.now();
      const pcm = await decoder.chunk(offset, length, rate);
      signal.throwIfAborted();
      if (!pcm.length) throw new Error('音频提前结束，解码结果不完整。');
      const frames = pcm.length / info.channels,
        seconds = frames / rate;
      if (seconds > length + 0.05) throw new Error('解码器输出超过缓冲限制。');
      totalMs += performance.now() - t;
      totalSeconds += seconds;
      this.buffered += seconds;
      node.port.postMessage(
        { type: 'chunk', samples: pcm, channels: info.channels },
        [pcm.buffer],
      );
      this.emit({ decodeMs: totalMs, decodedSeconds: totalSeconds });
      offset += seconds;
      if (first) {
        first = false;
        node.port.postMessage({ type: this.wantsPlay ? 'play' : 'pause' });
        this.prepared = true;
        if (this.wantsPlay) await context.resume();
        signal.throwIfAborted();
        this.emit({
          status: this.wantsPlay ? 'playing' : 'paused',
          message: '',
          startupMs: performance.now() - began,
        });
      }
    }
    signal.throwIfAborted();
    node.port.postMessage({ type: 'end' });
    decoder.close();
    this.decoderClose = undefined;
  }
  pause() {
    this.wantsPlay = false;
    this.audio.pause();
    this.worklet?.port.postMessage({ type: 'pause' });
    // A paused WASM seek still needs its first decoded segment. Keep the
    // preparation state until loadExtended is ready so new seeks are not lost.
    if (this.state.status !== 'preparing')
      this.emit({ status: 'paused', message: '' });
  }
  async resume() {
    if (!this.loadedFile || !this.loadedTrack) return;
    this.wantsPlay = true;
    try {
      if (this.nativeURL) await this.audio.play();
      else if (this.worklet) {
        await this.context?.resume();
        this.worklet.port.postMessage({ type: 'play' });
      } else return;
      this.emit({ status: 'playing', message: '' });
    } catch {
      this.wantsPlay = false;
      this.emit({
        status: 'paused',
        message: '浏览器暂未允许发声，请再次点击播放。',
      });
    }
  }
  seek(position: number) {
    const at = Math.max(0, Math.min(position, this.state.duration));
    if (this.nativeURL) {
      this.audio.currentTime = at;
      this.emit({ position: at });
      return;
    }
    if (this.loadedTrack && this.loadedFile) {
      const file = this.loadedFile;
      const resume = this.wantsPlay;
      void this.load(this.loadedTrack, () => Promise.resolve(file), at, resume);
    }
  }
}

export type NextTrack = {
  key: string;
  track: Track;
  resolve: () => Promise<File>;
  activate: () => void;
};
/** Owns two decks; only the foreground deck drives lyrics and persisted position. */
export class MusicPlayer {
  private context?: AudioContext;
  private master?: GainNode;
  private mix?: GainNode;
  private analyzer?: AnalyserNode;
  private visualizationEnabled = false;
  private visualData?: VisualizationFrame;
  enableVisualization(enabled: boolean) {
    this.visualizationEnabled = enabled;
    if (!enabled) {
      if (this.analyzer) {
        this.mix?.disconnect(this.analyzer);
        this.analyzer.disconnect();
      }
      this.analyzer = undefined;
      this.visualData = undefined;
    } else this.prepareAnalyzer();
  }
  private prepareAnalyzer() {
    if (
      !this.visualizationEnabled ||
      !this.context ||
      !this.mix ||
      this.analyzer
    )
      return;
    const { analyzer } = connectVisualizationAnalyzer(this.context, this.mix);
    this.analyzer = analyzer;
    this.visualData = {
      frequencies: new Uint8Array(this.analyzer.frequencyBinCount),
      waveform: new Uint8Array(this.analyzer.fftSize),
      sampleRate: this.context.sampleRate,
      playing: false,
    };
  }
  readVisualization(): VisualizationFrame | null {
    if (!this.analyzer || !this.visualData) return null;
    const data = this.visualData;
    this.analyzer.getByteFrequencyData(
      data.frequencies as Uint8Array<ArrayBuffer>,
    );
    this.analyzer.getByteTimeDomainData(
      data.waveform as Uint8Array<ArrayBuffer>,
    );
    data.playing =
      !this.paused &&
      this.context?.state === 'running' &&
      ['playing', 'buffering'].includes(this.active?.snapshot().status || '');
    return data;
  }
  private active?: PlaybackDeck;
  private standby?: PlaybackDeck;
  private outgoing?: PlaybackDeck;
  private candidate?: NextTrack;
  private options = { enabled: false, seconds: 5 };
  private transition?: { start: number; end: number };
  private missed = false;
  private starting = false;
  private paused = false;
  private volume = 0.7;
  private generation = 0;
  private timer?: ReturnType<typeof setInterval>;
  private update: (state: PlayerState) => void;
  private ended: () => void;
  constructor(update: (state: PlayerState) => void, ended: () => void) {
    this.update = update;
    this.ended = ended;
  }
  private ensureContext() {
    if (!this.context) {
      this.context = new AudioContext();
      const graph = connectPlayerAudioGraph(this.context, this.volume);
      this.mix = graph.mix;
      this.master = graph.master;
      this.prepareAnalyzer();
      this.timer = setInterval(() => this.tick(), 50);
    }
    return this.context;
  }
  private deck() {
    const context = this.ensureContext();
    const deck = new PlaybackDeck(
      (s) => {
        if (deck === this.active) this.update(s);
      },
      () => {
        if (deck === this.active) this.finish();
      },
      context,
    );
    deck.output.disconnect();
    deck.output.connect(this.mix!);
    return deck;
  }
  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master)
      this.master.gain.setValueAtTime(this.volume, this.context!.currentTime);
  }
  configure(enabled: boolean, seconds: number, candidate?: NextTrack) {
    this.options = { enabled, seconds: Math.max(1, Math.min(12, seconds)) };
    // A React update caused by promotion may configure the following song while fading.
    const next = enabled ? candidate : undefined;
    if (
      this.candidate?.key !== next?.key ||
      this.candidate?.track.playbackVersion !== next?.track.playbackVersion ||
      this.candidate?.track.size !== next?.track.size ||
      this.candidate?.track.modified !== next?.track.modified
    ) {
      if (this.starting) {
        this.generation++;
        this.starting = false;
      }
      this.standby?.destroy();
      this.standby = undefined;
      this.candidate = next;
    }
    if (!enabled) this.endTransition();
    this.prepare();
  }
  private prepare() {
    if (
      !this.active ||
      !this.candidate ||
      this.standby ||
      this.outgoing ||
      this.starting ||
      !this.options.enabled
    )
      return;
    const deck = this.deck();
    this.standby = deck;
    void deck.load(this.candidate.track, this.candidate.resolve, 0, false);
  }
  private endTransition() {
    this.outgoing?.destroy();
    this.outgoing = undefined;
    this.transition = undefined;
    if (this.active && this.context) {
      this.active.output.gain.cancelScheduledValues(this.context.currentTime);
      this.active.output.gain.setValueAtTime(1, this.context.currentTime);
    }
  }
  private reset() {
    this.generation++;
    this.starting = false;
    this.endTransition();
    this.active?.destroy();
    this.active = undefined;
    this.standby?.destroy();
    this.standby = undefined;
    this.missed = false;
    this.paused = false;
  }
  async load(
    track: Track,
    resolve: () => Promise<File>,
    start = 0,
    autoplay = true,
  ) {
    this.reset();
    const deck = this.deck();
    this.active = deck;
    this.paused = !autoplay;
    if (autoplay) void this.context!.resume().catch(() => {});
    const loading = deck.load(track, resolve, start, autoplay);
    this.prepare();
    await loading;
  }
  private tick() {
    if (!this.active || this.paused || this.starting) return;
    if (this.transition) {
      if (this.context!.currentTime >= this.transition.end) {
        this.endTransition();
        this.prepare();
      }
      return;
    }
    const s = this.active.snapshot();
    if (
      s.status !== 'playing' ||
      !this.options.enabled ||
      this.missed ||
      !this.candidate
    )
      return;
    const remaining = s.duration - this.active.positionNow();
    if (remaining > 0 && remaining <= this.options.seconds) {
      if (!this.standby?.prepared) {
        this.missed = true;
        return;
      }
      void this.promote(Math.min(this.options.seconds, remaining));
    }
  }
  private async promote(seconds: number) {
    const next = this.standby,
      candidate = this.candidate,
      old = this.active;
    if (!next || !candidate || !old || this.starting) return;
    const generation = this.generation;
    this.starting = true;
    next.output.gain.setValueAtTime(0, this.context!.currentTime);
    await next.resume();
    if (generation !== this.generation || this.standby !== next) {
      if (!this.starting && this.active?.snapshot().status === 'ended')
        this.finish();
      return;
    }
    this.starting = false;
    if (next.snapshot().status !== 'playing') {
      next.pause();
      this.missed = true;
      if (old.snapshot().status === 'ended') {
        this.standby?.destroy();
        this.standby = undefined;
        this.candidate = undefined;
        this.ended();
      }
      return;
    }
    const now = this.context!.currentTime;
    this.active = next;
    this.standby = undefined;
    this.candidate = undefined;
    this.missed = false;
    if (seconds > 0) {
      this.outgoing = old;
      this.transition = { start: now, end: now + seconds };
      old.output.gain.setValueAtTime(1, now);
      old.output.gain.linearRampToValueAtTime(0, now + seconds);
      next.output.gain.linearRampToValueAtTime(1, now + seconds);
    } else {
      old.destroy();
      next.output.gain.setValueAtTime(1, now);
    }
    candidate.activate();
    this.update(next.snapshot());
    if (this.paused) {
      next.pause();
      old.pause();
    }
  }
  private finish() {
    if (this.starting) return;
    this.endTransition();
    if (this.options.enabled && this.candidate) {
      if (this.standby?.prepared) {
        void this.promote(0);
        return;
      }
      const candidate = this.candidate;
      this.candidate = undefined;
      candidate.activate();
      void this.load(candidate.track, candidate.resolve);
    } else this.ended();
  }
  pause() {
    this.paused = true;
    this.active?.pause();
    this.outgoing?.pause();
    void this.context?.suspend().catch(() => {});
  }
  async resume() {
    this.paused = false;
    try {
      await this.context?.resume();
      await Promise.all([this.active?.resume(), this.outgoing?.resume()]);
    } catch {
      this.paused = true;
      if (this.active)
        this.update({
          ...this.active.snapshot(),
          status: 'paused',
          message: '请再次点击播放以允许浏览器发声。',
        });
    }
  }
  seek(position: number) {
    this.generation++;
    this.starting = false;
    if (this.standby && this.standby.snapshot().status === 'playing')
      this.standby.pause();
    this.endTransition();
    this.missed = false;
    this.active?.seek(position);
    this.prepare();
  }
  stop() {
    this.reset();
    this.candidate = undefined;
    this.update({ ...idlePlayer });
  }
  cancel() {
    this.reset();
    this.update({ ...idlePlayer, status: 'paused', message: '已取消准备' });
  }
  destroy() {
    this.reset();
    if (this.timer) clearInterval(this.timer);
    this.enableVisualization(false);
    this.mix?.disconnect();
    this.master?.disconnect();
    void this.context?.close().catch(() => {});
    this.context = undefined;
    this.mix = undefined;
    this.master = undefined;
  }
}
