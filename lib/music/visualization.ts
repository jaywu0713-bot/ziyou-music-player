export type VisualizationStyle = 'bars' | 'lines';
export type VisualizationFrame = {
  frequencies: Uint8Array;
  waveform: Uint8Array;
  sampleRate: number;
  playing: boolean;
};
export function visualizationStyle(value: unknown): VisualizationStyle {
  return value === 'lines' ? 'lines' : 'bars';
}
/** A unity mix bus feeds both analysis and the user-controlled output gain. */
export function connectPlayerAudioGraph(context: AudioContext, volume: number) {
  const mix=context.createGain();
  mix.gain.value=1;
  const master=context.createGain();
  master.gain.value=volume;
  mix.connect(master);
  master.connect(context.destination);
  return {mix,master};
}
/** Keep analysis inside the live audio graph while silencing its output branch. */
export function connectVisualizationAnalyzer(context: AudioContext, master: GainNode) {
  const analyzer=context.createAnalyser();
  analyzer.fftSize=2048;
  analyzer.smoothingTimeConstant=0.65;
  const sink=context.createGain();
  sink.gain.value=0;
  master.connect(analyzer);
  analyzer.connect(sink);
  sink.connect(context.destination);
  return {analyzer,sink};
}
/** Log-spaced bands cover audible frequencies, independent of output sample rate. */
export function frequencyBands(
  frame: VisualizationFrame,
  count = 48,
): number[] {
  const binHz = frame.sampleRate / (frame.frequencies.length * 2);
  const maximum = Math.min(16000, frame.sampleRate / 2);
  return Array.from({ length: count }, (_, i) => {
    const low = Math.max(
      0,
      Math.floor((30 * (maximum / 30) ** (i / count)) / binHz),
    );
    const high = Math.min(
      frame.frequencies.length,
      Math.max(
        low + 1,
        Math.ceil((30 * (maximum / 30) ** ((i + 1) / count)) / binHz),
      ),
    );
    let peak = 0;
    for (let j = low; j < high; j++)
      peak = Math.max(peak, frame.frequencies[j] / 255);
    return peak;
  });
}
export function smoothLevel(current: number, target: number, elapsed: number) {
  const rate = target > current ? 18 : 5;
  const next =
    current +
    (target - current) *
      (1 - Math.exp(-rate * Math.max(0, Math.min(0.1, elapsed))));
  return Math.abs(next) < 0.001 ? 0 : next;
}
export class VisualizationRenderer {
  private levels = Array<number>(48).fill(0);
  private wave = Array<number>(256).fill(0);
  private bass = 0;
  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizationFrame | null,
    style: VisualizationStyle,
    elapsed: number,
    accent?: string,
  ) {
    const playing = frame?.playing === true;
    const targets = playing ? frequencyBands(frame) : [];
    this.levels = this.levels.map((v, i) =>
      smoothLevel(v, targets[i] || 0, elapsed),
    );
    this.bass = smoothLevel(
      this.bass,
      playing ? Math.max(...targets.slice(0, 10)) : 0,
      elapsed,
    );
    this.wave = this.wave.map((v, i) =>
      smoothLevel(
        v,
        playing
          ? (frame.waveform[
              Math.floor((i * frame.waveform.length) / this.wave.length)
            ] -
              128) /
              128
          : 0,
        elapsed,
      ),
    );
    ctx.clearRect(0, 0, width, height);
    if (style === 'bars') {
      const gap = Math.max(2, width / 220),
        bar = (width * 0.88 - gap * 47) / 48;
      const gradient = ctx.createLinearGradient(
        0,
        height * 0.15,
        0,
        height * 0.85,
      );
      gradient.addColorStop(0, accent || '#d6ff9c');
      gradient.addColorStop(1, accent || '#4ea789');
      ctx.fillStyle = gradient;
      this.levels.forEach((level, i) => {
        const h = Math.max(2, level * height * 0.7);
        ctx.fillRect(
          width * 0.06 + i * (bar + gap),
          height * 0.86 - h,
          Math.max(1, bar),
          h,
        );
      });
    } else {
      ctx.save();
      ctx.translate(width / 2, height / 2);
      const scale = 1 + this.bass * 0.09;
      ctx.scale(scale, scale);
      [accent || '#b7f36b', accent || '#65dcd5'].forEach((color, line) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.shadowColor = color;
        ctx.shadowBlur = 12 + this.bass * 12;
        for (let i = 0; i < this.wave.length; i++) {
          const x = (i / (this.wave.length - 1) - 0.5) * width * 0.83;
          const envelope = Math.sin((Math.PI * i) / (this.wave.length - 1));
          const y =
            (line === 0 ? -1 : 1) *
            (height * 0.08 + this.wave[i] * height * 0.25 * envelope);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
      ctx.restore();
    }
  }
}
