import test from 'node:test';
import assert from 'node:assert/strict';
import { displayMessage, languageOf, message, setLanguage, translate } from '../lib/i18n/core.ts';

void test('interface language translates fixed and parameterized messages', () => {
  setLanguage('en');
  assert.equal(translate('播放'), 'Play');
  assert.equal(displayMessage(message('扫描 {0}…', { 0: 3 })), 'Scanning 3…');
  setLanguage('zh-CN');
  assert.equal(displayMessage(message('扫描 {0}…', { 0: 3 })), '扫描 3…');
});

void test('invalid persisted language safely falls back to Chinese', () => {
  assert.equal(languageOf('fr'), 'zh-CN');
  assert.equal(languageOf('en'), 'en');
});
