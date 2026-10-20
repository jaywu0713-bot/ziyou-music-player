import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicPlayer, type PlayerState } from '../lib/music/player.ts';
import type { Track } from '../lib/music/model.ts';
class Param {
  value = 1;
  events: { kind: string; value: number; time: number }[] = [];
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ kind: 'set', value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'ramp', value, time });
  }
  cancelScheduledValues(time: number) {
    this.events = this.events.filter((e) => e.time < time);
  }
}
class Gain {
  targets: unknown[] = [];
  gain = new Param();
  connect(target?: unknown) {
    this.targets.push(target);
    return this;
  }
  disconnect(target?: unknown) {
    this.targets = target ? this.targets.filter((t) => t !== target) : [];
  }
}
class Context {
  static latest: Context;
  currentTime = 0;
  sampleRate = 48000;
  state = 'running';
  destination = {};
  constructor() {
    Context.latest = this;
  }
  createAnalyser() {
    return Object.assign(new Gain(), {
      fftSize: 2048,
      frequencyBinCount: 1024,
      smoothingTimeConstant: 0.65,
      getByteFrequencyData(data: Uint8Array) {
        data.fill(128);
      },
      getByteTimeDomainData(data: Uint8Array) {
        data.fill(128);
      },
    });
  }
  createGain() {
    return new Gain();
  }
  createMediaElementSource() {
    return new Gain();
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {
    this.state = 'closed';
  }
}
class AudioMock extends EventTarget {
  static all: AudioMock[] = [];
  currentTime = 0;
  duration = 60;
  readyState = 4;
  volume = 1;
  paused = true;
  src = '';
  preload = '';
  ontimeupdate?: () => void;
  onended?: () => void;
  onplaying?: () => void;
  constructor() {
    super();
    AudioMock.all.push(this);
  }
  load() {
    if (this.src)
      queueMicrotask(() => {
        this.dispatchEvent(new Event('loadedmetadata'));
        this.dispatchEvent(new Event('canplay'));
      });
  }
  removeAttribute() {
    this.src = '';
  }
  async play() {
    this.paused = false;
    this.onplaying?.();
  }
  pause() {
    this.paused = true;
  }
  at(time: number) {
    this.currentTime = time;
    this.ontimeupdate?.();
  }
  end() {
    this.at(this.duration);
    this.paused = true;
    this.onended?.();
  }
}
Object.assign(globalThis, { Audio: AudioMock, AudioContext: Context });
const track = (id: string): Track => ({
  id,
  name: id + '.wav',
  format: 'WAV',
  duration: 60,
  groups: [],
});
const file = () => Promise.resolve(new File(['RIFF0000WAVE'], 'music.wav'));
void test('changing audio version while paused preserves pause and position', async (t) => {
  const h=harness(t);
  await h.player.load(track('a'),file,12,false);
  assert.equal(h.state()?.status,'paused');
  assert.equal(h.state()?.position,12);
});
void test('changing next song version refreshes preloaded audio without changing queue occurrence', async (t) => {
  const h=harness(t);
  await h.player.load(track('a'),file);
  h.player.configure(true,5,h.next);
  await settle();
  let refreshed=0;
  h.player.configure(true,5,{...h.next,track:{...h.next.track,playbackVersion:'instrumental'},resolve:()=>{refreshed++;return file();}});
  await settle();
  assert.equal(refreshed,1);
});
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness(t: { after: (cb: () => void) => void }) {
  AudioMock.all = [];
  let switched = 0,
    ended = 0;
  let state: PlayerState | undefined;
  const player = new MusicPlayer(
    (s) => {
      state = s;
    },
    () => ended++,
  );
  t.after(() => player.destroy());
  const controls = player as unknown as {
    tick: () => void;
    active: { output: Gain };
    outgoing?: unknown;
    transition?: { end: number };
  };
  const next = {
    key: 'b',
    track: track('b'),
    resolve: file,
    activate: () => switched++,
  };
  return {
    player,
    controls,
    next,
    switched: () => switched,
    ended: () => ended,
    state: () => state,
  };
}
void test('two native decks crossfade once, switch the foreground clock and retire the old deck', async (t) => {
  const h = harness(t);
  await h.player.load(track('a'), file);
  h.player.configure(true, 5, h.next);
  await settle();
  const [a, b] = AudioMock.all;
  assert.equal(b.paused, true);
  a.at(55);
  h.controls.tick();
  await settle();
  assert.equal(h.switched(), 1);
  assert.equal(b.paused, false);
  assert.equal(h.state()?.position, 0);
  assert.deepEqual(h.controls.active.output.gain.events.at(-1), {
    kind: 'ramp',
    value: 1,
    time: 5,
  });
  a.end();
  assert.equal(h.ended(), 0);
  Context.latest.currentTime = 5;
  h.controls.tick();
  assert.equal(h.controls.outgoing, undefined);
  b.end();
  assert.equal(h.ended(), 1);
});
void test('unready next song does not fade current song or start a late fade', async (t) => {
  const h = harness(t);
  let resolve!: (f: File) => void;
  await h.player.load(track('a'), file);
  h.player.configure(true, 5, {
    ...h.next,
    resolve: () =>
      new Promise<File>((r) => {
        resolve = r;
      }),
  });
  const a = AudioMock.all[0];
  a.at(55);
  h.controls.tick();
  assert.equal(h.switched(), 0);
  assert.equal(h.controls.active.output.gain.value, 1);
  resolve(await file());
  await settle();
  a.at(58);
  h.controls.tick();
  await settle();
  assert.equal(h.switched(), 0);
  a.end();
  await settle();
  assert.equal(h.switched(), 1);
  assert.equal(h.controls.outgoing, undefined);
});
void test('seeking into final three seconds shortens fade; seeking during fade retires old audio', async (t) => {
  const h = harness(t);
  await h.player.load(track('a'), file);
  h.player.configure(true, 5, h.next);
  await settle();
  h.player.seek(57);
  h.controls.tick();
  await settle();
  assert.equal(h.controls.transition?.end, 3);
  h.player.seek(20);
  assert.equal(AudioMock.all[0].paused, true);
  assert.equal(AudioMock.all[1].currentTime, 20);
  assert.equal(h.controls.outgoing, undefined);
  assert.equal(h.controls.active.output.gain.value, 1);
});
void test('pause freezes both decks and audio clock; resume keeps the remaining envelope', async (t) => {
  const h = harness(t);
  await h.player.load(track('a'), file);
  h.player.configure(true, 5, h.next);
  await settle();
  AudioMock.all[0].at(55);
  h.controls.tick();
  await settle();
  Context.latest.currentTime = 2;
  h.player.pause();
  assert.ok(AudioMock.all.every((a) => a.paused));
  assert.equal(Context.latest.state, 'suspended');
  h.controls.tick();
  assert.equal(h.controls.transition?.end, 5);
  await h.player.resume();
  assert.ok(AudioMock.all.every((a) => !a.paused));
  assert.equal(h.controls.transition?.end, 5);
});
void test('manual load cancels both old decks; disabled crossfade never preloads', async (t) => {
  const h = harness(t);
  await h.player.load(track('a'), file);
  h.player.configure(true, 5, h.next);
  await settle();
  AudioMock.all[0].at(55);
  h.controls.tick();
  await settle();
  h.player.configure(false, 5);
  await h.player.load(track('c'), file);
  assert.ok(AudioMock.all.slice(0, 2).every((a) => a.paused));
  assert.equal(h.controls.outgoing, undefined);
  AudioMock.all.at(-1)!.at(58);
  h.controls.tick();
  assert.equal(h.switched(), 1);
});

void test('Jamendo tracks play their validated stream URL without resolving a local file', async (t) => {
  const h = harness(t);
  const online: Track = {
    ...track('online'),
    name: 'Free song',
    catalog: {
      provider: 'jamendo',
      providerId: '123',
      artist: 'Artist',
      streamUrl: 'https://prod-1.storage.jamendo.com/stream.mp3',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      pageUrl: 'https://www.jamendo.com/track/123',
    },
  };
  await h.player.load(online, async () => {
    throw new Error('online playback must not ask for a local file');
  });
  assert.equal(AudioMock.all[0].src, online.catalog!.streamUrl);
  assert.equal(h.state()?.path, 'Jamendo · 在线串流');
});

void test('visual analysis taps pre-volume mix and detaches without removing audible output', async (t) => {
  const h = harness(t);
  h.player.enableVisualization(true);
  assert.equal(h.player.readVisualization(), null);
  await h.player.load(track('a'), file);
  const internals = h.player as unknown as { master: Gain; mix: Gain };
  assert.equal(internals.mix.targets.length, 2);
  assert.equal(internals.mix.targets[0], internals.master);
  assert.equal((internals.mix.targets[1] as {fftSize:number}).fftSize, 2048);
  assert.deepEqual(internals.master.targets, [Context.latest.destination]);
  h.player.setVolume(0);
  assert.equal(internals.master.gain.value, 0);
  const frame = h.player.readVisualization();
  assert.equal(frame?.frequencies.length, 1024);
  assert.equal(frame?.playing, true);
  h.player.pause();
  assert.equal(h.player.readVisualization()?.playing, false);
  h.player.enableVisualization(false);
  assert.equal(h.player.readVisualization(), null);
  assert.deepEqual(internals.mix.targets, [internals.master]);
  assert.deepEqual(internals.master.targets, [Context.latest.destination]);
});
