import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

test.use({ headless: false });
const wav = path.resolve('tests/fixtures/tone.wav');
const flac = path.resolve('tests/fixtures/tone.flac');

async function prepare(page: Page, filename = 'tone.wav') {
  await page.goto('/');
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
  await page.locator('input[type=file]').first().setInputFiles(filename === 'tone.wav' ? [wav, flac] : [path.resolve('tests/fixtures', filename)]);
  await page.getByRole('button', { name: `播放 ${filename}`, exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '歌词', exact: true }).click();
  await page.getByRole('button', { name: '导入 .lrc', exact: true }).click();
  await page.getByLabel('歌词文件', { exact: true }).setInputFiles({
    name: '测试.lrc', mimeType: 'text/plain',
    buffer: Buffer.from('[00:00]第一句\n[00:02]第二句\n[00:04]<b>纯文本</b>\n[00:06]尾声'),
  });
  await page.getByRole('button', { name: '使用这份歌词' }).click();
}

async function openWindow(page: Page) {
  const popup = page.context().waitForEvent('page');
  await page.getByRole('button', { name: '悬浮歌词', exact: true }).click();
  const windowPage = await popup;
  await expect(windowPage.locator('.lyrics-window')).toBeVisible();
  expect(await windowPage.evaluate(() => matchMedia('(display-mode: picture-in-picture)').matches)).toBe(true);
  return windowPage;
}

test('real PiP shares playback, toggles lyrics-only preferences, persists settings and closes independently', async ({ page }) => {
  await prepare(page);
  const popup = await openWindow(page);
  await expect(popup.locator('.lyrics-window-current')).toHaveText('第一句');
  await expect(popup.locator('.lyrics-window-settings')).toHaveCount(0);
  await expect(popup.locator('.lyrics-window-controls')).toHaveCount(0);
  // Keyboard users can discover the otherwise hidden settings switch.
  await popup.getByRole('switch', { name: '偏好设置' }).focus();
  await expect(popup.locator('.lyrics-window-preference-switch')).toHaveCSS('opacity', '1');
  await popup.getByRole('switch', { name: '偏好设置' }).press('Space');
  await expect(popup.locator('.lyrics-window-settings')).toBeVisible();
  await popup.getByRole('combobox', { name: '悬浮歌词字体' }).selectOption('serif');
  await popup.getByRole('combobox', { name: '悬浮歌词显示行数' }).selectOption('1');
  const size = popup.getByRole('group', { name: '悬浮歌词字号' }).getByRole('slider');
  await size.focus(); await size.press('ArrowRight');
  await expect(popup.locator('.lyrics-window-font-size output')).toHaveText('29 px');
  await popup.getByRole('switch', { name: '偏好设置' }).click();
  await expect(popup.locator('.lyrics-window-settings')).toHaveCount(0);
  await expect(popup.locator('.lyrics-window-next')).toHaveCount(0);
  await expect(popup.locator('.lyrics-window-current')).toHaveCSS('font-size', '29px');
  // Main-window seek updates PiP immediately while paused.
  const seek = page.getByRole('group', { name: '播放进度' }).getByRole('slider');
  await seek.focus(); await seek.press('Home'); await seek.press('ArrowRight'); await seek.press('ArrowRight');
  await expect(popup.locator('.lyrics-window-current')).toHaveText('第二句');
  await expect(page.locator('.lyric-line.is-active')).toHaveText('第二句');
  await page.getByRole('button', { name: '小窗偏好', exact: true }).click();
  await expect(popup.locator('.lyrics-window-settings')).toBeVisible();
  await popup.getByRole('button', { name: '播放', exact: true }).click();
  await expect(popup.locator('.lyrics-window-current')).toHaveText('<b>纯文本</b>');
  await expect(popup.locator('.lyrics-window-current b')).toHaveCount(0);
  await popup.close();
  await expect(page.getByRole('button', { name: '悬浮歌词', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const reopened = await openWindow(page);
  await expect(reopened.locator('.lyrics-window-current')).toHaveCSS('font-size', '29px');
  await expect(reopened.locator('.lyrics-window-settings')).toHaveCount(0);
  await page.reload();
  await expect.poll(() => reopened.isClosed()).toBe(true);
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
  await page.getByRole('button', { name: '歌词', exact: true }).click();
  const restored = await openWindow(page);
  await page.getByRole('button', { name: '小窗偏好', exact: true }).click();
  await expect(restored.getByRole('combobox', { name: '悬浮歌词字体' })).toHaveValue('serif');
  await expect(restored.getByRole('combobox', { name: '悬浮歌词显示行数' })).toHaveValue('1');
  await expect(restored.locator('.lyrics-window-font-size output')).toHaveText('29 px');
});

test('PiP follows track changes, lyric removal, and repeated opening reuses one window', async ({ page }) => {
  await prepare(page);
  const popup = await openWindow(page);
  await page.getByRole('button', { name: '回到歌词小窗', exact: true }).click();
  expect(page.context().pages()).toHaveLength(2);
  await page.getByRole('button', { name: '下一首', exact: true }).click();
  await expect(popup.locator('.lyrics-window-empty')).toContainText('暂无歌词');
  await expect(popup.locator('.lyrics-window-empty')).toContainText('tone.flac');
  await page.getByRole('button', { name: '上一首', exact: true }).click();
  await expect(popup.locator('.lyrics-window-current')).toHaveText('第一句');
  await page.getByRole('button', { name: '移除歌词', exact: true }).click();
  await page.getByRole('button', { name: '确认移除歌词', exact: true }).click();
  await expect(popup.locator('.lyrics-window-empty')).toContainText('暂无歌词');
  await page.getByRole('button', { name: '关闭小窗', exact: true }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
});

test('unsupported and rejected PiP leave page lyrics usable and can retry', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined });
  });
  await prepare(page);
  await page.getByRole('button', { name: '悬浮歌词', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('此浏览器不支持歌词小窗口');
  await expect(page.locator('.lyrics-scroll')).toContainText('第一句');
  await page.reload();
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
  await page.evaluate(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: {
      requestWindow: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
    } });
  });
  await page.getByRole('button', { name: '歌词', exact: true }).click();
  await page.getByRole('button', { name: '悬浮歌词', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('浏览器暂未允许');
  await expect(page.getByRole('button', { name: '悬浮歌词', exact: true })).toBeEnabled();
});

test('DSF continues to update real PiP from the actual output clock while the opener is in the background', async ({ page }) => {
  await prepare(page, 'tone.dsf');
  const popup = await openWindow(page);
  await page.getByRole('button', { name: '小窗偏好', exact: true }).click();
  await popup.bringToFront();
  await popup.getByRole('button', { name: '播放', exact: true }).click();
  await expect(popup.locator('.lyrics-window-current')).toHaveText('第二句', { timeout: 8000 });
  await popup.getByRole('button', { name: '暂停', exact: true }).click();
  const lyric = await popup.locator('.lyrics-window-current').textContent();
  await page.waitForTimeout(300);
  await expect(popup.locator('.lyrics-window-current')).toHaveText(lyric!);
  const seek = page.getByRole('group', { name: '播放进度' }).getByRole('slider');
  await seek.focus(); await seek.press('Home');
  await expect(seek).toBeEnabled();
  await expect(popup.locator('.lyrics-window-current')).toHaveText('第一句');
});
