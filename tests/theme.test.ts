import test from 'node:test';
import assert from 'node:assert/strict';
import { wcagContrast } from 'culori';
import { resolveTheme } from '../lib/music/theme.ts';

test('custom accent stays readable on both system appearances', () => {
  for (const dark of [false,true]) {
    const result=resolveTheme({themeMode:'system',themePreset:'forest',accentColor:'#777777'},dark);
    assert.ok(wcagContrast(result.accent,result.background)>=4.5);
    assert.equal(result.dark,dark);
  }
});
test('chosen appearance overrides system and invalid custom accent falls back to preset', () => {
  assert.equal(resolveTheme({themeMode:'light',themePreset:'ocean',accentColor:''},true).dark,false);
  assert.equal(resolveTheme({themeMode:'dark',themePreset:'rose',accentColor:'invalid'},false).dark,true);
});
