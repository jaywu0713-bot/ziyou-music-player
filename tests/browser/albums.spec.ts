import { test, expect } from '@playwright/test';
import path from 'node:path';
test.use({ baseURL: 'http://127.0.0.1:1420' });
test('albums browse into details, queue songs, and return without changing playback', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'locks', { value: undefined }),
  );
  await page.goto('/desktop.html');
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(path.resolve('tests/fixtures/tone.wav'));
  await page
    .getByRole('button', { name: '播放 tone.wav', exact: true })
    .click();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page
    .getByRole('button', { name: /^专辑/ })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: '专辑', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /打开专辑 未知专辑/ }).click();
  await expect(
    page.getByRole('button', { name: '播放全部', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '加入队列', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '播放', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '返回专辑', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '专辑', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/album-grid.png' });
  expect(errors).toEqual([]);
});
