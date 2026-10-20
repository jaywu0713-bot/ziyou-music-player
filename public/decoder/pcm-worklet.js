class PCMQueue extends AudioWorkletProcessor {
  constructor() {
    super(); this.chunks = []; this.offset = 0; this.frames = 0; this.played = 0;
    this.active = false; this.finished = false; this.tick = 0; this.ended = false;
    this.port.onmessage = ({data}) => {
      if (data.type === 'chunk') {this.chunks.push(data.samples); this.frames += data.samples.length / data.channels; this.channels = data.channels;}
      if (data.type === 'play') this.active = true;
      if (data.type === 'pause') this.active = false;
      if (data.type === 'end') this.finished = true;
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0]; if (!out.length) return true;
    let written = 0;
    if (this.active) {
      while (written < out[0].length && this.chunks.length) {
        const first = this.chunks[0], channels = this.channels;
        const count = Math.min(out[0].length - written, (first.length - this.offset) / channels);
        for (let i = 0; i < count; i++) for (let c = 0; c < out.length; c++) out[c][written + i] = first[this.offset + i * channels + c] || 0;
        this.offset += count * channels; written += count; this.frames -= count; this.played += count;
        if (this.offset >= first.length) {this.chunks.shift();this.offset = 0;}
      }
    }
    if (++this.tick % 32 === 0) this.port.postMessage({type:'status', buffered: this.frames, played:this.played, underrun:this.active && !this.frames && !this.finished});
    if (this.active && this.finished && !this.frames && !this.ended) {this.ended=true;this.port.postMessage({type:'ended',played:this.played});}
    return true;
  }
}
registerProcessor('ziyou-pcm', PCMQueue);
