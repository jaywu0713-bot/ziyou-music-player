import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectPlayerAudioGraph,
  connectVisualizationAnalyzer,
  frequencyBands,
  smoothLevel,
  visualizationStyle,
  VisualizationRenderer,
  type VisualizationFrame,
} from '../lib/music/visualization.ts';
import { openVisualizationWindow } from '../lib/music/visualization-window.ts';
void test('visual styles default safely and logarithmic bands respond to real input', () => {
  assert.equal(visualizationStyle(undefined), 'bars');
  assert.equal(visualizationStyle('bad'), 'bars');
  assert.equal(visualizationStyle('lines'), 'lines');
  const frame: VisualizationFrame = {
    frequencies: new Uint8Array(1024).fill(255),
    waveform: new Uint8Array(2048).fill(128),
    sampleRate: 48000,
    playing: true,
  };
  assert.deepEqual(frequencyBands(frame), Array(48).fill(1));
  frame.frequencies.fill(0);
  assert.deepEqual(frequencyBands(frame), Array(48).fill(0));
  let value = 1;
  for (let i = 0; i < 90; i++) value = smoothLevel(value, 0, 1 / 30);
  assert.equal(value, 0);
});
void test('analyzer branch reaches the audio graph through a muted sink', () => {
  const links: Array<[unknown, unknown]> = [];
  const destination={id:'destination'};
  const nodes: Array<{id:string;gain:{value:number};connect:(to:unknown)=>void;disconnect:()=>void}> = [];
  const node=(id:string)=>{const value={id,gain:{value:1},connect:(to:unknown)=>links.push([value,to]),disconnect(){}};nodes.push(value);return value;};
  const analyzer={id:'analyzer',fftSize:0,smoothingTimeConstant:0,connect:(to:unknown)=>links.push([analyzer,to]),disconnect(){}};
  const context={destination,createAnalyser:()=>analyzer,createGain:()=>node(`gain-${nodes.length}`)};
  const {mix,master}=connectPlayerAudioGraph(context as never,0);
  const result=connectVisualizationAnalyzer(context as never,mix as never);
  const sink=result.sink as unknown;
  assert.equal(result.analyzer,analyzer);
  assert.equal(analyzer.fftSize,2048);
  assert.deepEqual(links,[[mix,master],[master,destination],[mix,analyzer],[analyzer,sink],[sink,destination]]);
  assert.equal(master.gain.value,0);
  assert.equal(mix.gain.value,1);
  assert.equal((sink as {gain:{value:number}}).gain.value,0);
});
void test('both renderers draw and paused line output settles without fake motion', () => {
  let bars = 0,
    strokes = 0;
  const points: number[] = [];
  const ctx = {
    clearRect() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {
      bars++;
    },
    save() {},
    restore() {},
    translate() {},
    scale() {},
    beginPath() {},
    stroke() {
      strokes++;
    },
    moveTo(_x: number, y: number) {
      points.push(y);
    },
    lineTo(_x: number, y: number) {
      points.push(y);
    },
  } as unknown as CanvasRenderingContext2D;
  const renderer = new VisualizationRenderer();
  renderer.draw(ctx, 600, 300, null, 'bars', 1 / 30);
  assert.equal(bars, 48);
  renderer.draw(ctx, 600, 300, null, 'lines', 1 / 30);
  assert.equal(strokes, 2);
  assert.ok(points.every((y) => y === -24 || y === 24));
});
function fakeWindows(blocked = false) {
  const element = () => ({
    append() {},
    appendChild() {},
    replaceChildren() {},
    setAttribute() {},
    getContext: () => ({}),
    style: {},
    clientWidth: 600,
    clientHeight: 300,
  });
  const child = Object.assign(new EventTarget(), {
    closed: false,
    document: {
      documentElement: {},
      head: element(),
      body: element(),
      createElement: element,
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    focus() {},
    close() {
      this.closed = true;
      (this as unknown as EventTarget).dispatchEvent(new Event('pagehide'));
    },
  });
  let intervals = 0,
    cleared = 0,
    pipCalls = 0;
  const host = Object.assign(new EventTarget(), {
    open: () => (blocked ? null : child),
    setInterval: () => ++intervals,
    clearInterval() {
      cleared++;
    },
    documentPictureInPicture: {
      requestWindow() {
        pipCalls++;
      },
    },
  });
  return {
    host: host as unknown as Window,
    child,
    cleared: () => cleared,
    pipCalls: () => pipCalls,
  };
}
void test('popup close cleans up once and never calls or closes lyrics PiP', () => {
  const f = fakeWindows();
  let closed = 0;
  const popup = openVisualizationWindow(
    f.host,
    () => null,
    () => 'bars',
    () => closed++,
  );
  assert.equal(f.pipCalls(), 0);
  popup.close();
  popup.close();
  assert.equal(closed, 1);
  assert.equal(f.cleared(), 1);
  assert.equal(f.child.closed, true);
});
void test('native child close and parent navigation both synchronize popup lifetime', () => {
  for (const parent of [false, true]) {
    const f = fakeWindows();
    let closed = 0;
    openVisualizationWindow(
      f.host,
      () => null,
      () => 'lines',
      () => closed++,
    );
    if (parent) f.host.dispatchEvent(new Event('pagehide'));
    else f.child.close();
    assert.equal(closed, 1);
    assert.equal(f.child.closed, true);
    assert.equal(f.cleared(), 1);
  }
});
void test('popup blockers yield an actionable error without a fake open state', () => {
  const f = fakeWindows(true);
  assert.throws(
    () =>
      openVisualizationWindow(
        f.host,
        () => null,
        () => 'bars',
        () => {},
      ),
    /允许本站弹出窗口/,
  );
});
