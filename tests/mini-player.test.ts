import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMiniAction,
  MiniWindowController,
  collapsedWindowSize,
} from '../lib/desktop/mini-player.ts';

void test('collapsed mini styles keep independent compact window dimensions', () => {
  assert.deepEqual(collapsedWindowSize('edge-tab'), { width: 48, height: 84 });
  assert.deepEqual(collapsedWindowSize('cover-tile'), { width: 80, height: 80 });
});

void test('mini controls reject unknown commands and unsafe slider values', () => {
  assert.deepEqual(parseMiniAction({ type: 'volume', value: 32 }), {
    type: 'volume',
    value: 32,
  });
  for (const value of [-1, 101, NaN, Infinity, '50'])
    assert.equal(parseMiniAction({ type: 'volume', value }), null);
  assert.equal(parseMiniAction({ type: 'seek', value: -3 }), null);
  assert.equal(parseMiniAction({ type: 'erase-library' }), null);
  assert.equal(parseMiniAction({ type: 'mode', value: 'hidden' }), null);
  assert.deepEqual(parseMiniAction({ type: 'mode', value: 'mini-only' }), {
    type: 'mode',
    value: 'mini-only',
  });
});
function harness(fail = '') {
  const calls: string[] = [];
  const call = (name: string) => async () => {
    calls.push(name);
    if (name === fail) throw new Error(name);
  };
  const controller = new MiniWindowController({
    showMini: call('show-mini'),
    focusMini: call('focus-mini'),
    hideMain: call('hide-main'),
    showMain: call('show-main'),
    restore: call('restore'),
    saveMode: async (mode) => {
      calls.push(mode);
    },
  });
  return { controller, calls };
}
void test('only-mini mode shows the control window before hiding the audio owner', async () => {
  const { controller, calls } = harness();
  await controller.open('mini-only');
  assert.deepEqual(calls, [
    'show-mini',
    'focus-mini',
    'hide-main',
    'mini-only',
  ]);
});
void test('opening failure restores the main window and never hides it first', async () => {
  const { controller, calls } = harness('show-mini');
  await assert.rejects(controller.open('mini-only'));
  assert.deepEqual(calls, ['show-mini', 'restore']);
});
void test('rapid mode changes and restore execute in order without losing a control window', async () => {
  const { controller, calls } = harness();
  await Promise.all([
    controller.open('mini-only'),
    controller.open('both'),
    controller.restore(),
  ]);
  assert.deepEqual(calls, [
    'show-mini',
    'focus-mini',
    'hide-main',
    'mini-only',
    'show-mini',
    'focus-mini',
    'show-main',
    'both',
    'restore',
  ]);
});
