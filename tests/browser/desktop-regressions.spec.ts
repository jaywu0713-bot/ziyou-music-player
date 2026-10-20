import { test, expect } from '@playwright/test';
import path from 'node:path';

test.use({baseURL:'http://127.0.0.1:1420'});

test('cover dialog remains interactive after opening lyric search', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // The development entry intentionally uses StrictMode; isolate these UI
  // regressions from its duplicate-effect navigator.locks race.
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', {value:undefined}));
  await page.goto('/desktop.html');
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
  await page.locator('input[type=file]').first().setInputFiles(path.resolve('tests/fixtures/tone.wav'));
  await page.getByRole('button', {name:'播放 tone.wav', exact:true}).click();
  await page.getByRole('button', {name:'暂停', exact:true}).click();
  await page.getByRole('button', {name:'歌词', exact:true}).click();
  await page.getByRole('button', {name:'联网搜索', exact:true}).click();
  await page.getByRole('button', {name:'歌曲封面', exact:true}).click();
  await expect(page.getByRole('dialog').filter({has:page.getByText('歌曲封面', {exact:true})})).toBeVisible();
  await expect(page.locator('.lyrics-sheet')).toHaveCount(0);
  await page.getByRole('textbox', {name:'歌曲名称', exact:true}).fill('Sample Song');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cover-dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});
