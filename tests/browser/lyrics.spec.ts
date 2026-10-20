import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const wav = path.resolve('tests/fixtures/tone.wav');
const flac = path.resolve('tests/fixtures/tone.flac');
const lrc = '[ti:合成测试]\n[00:00.00]开场\n[00:02.00]第二句\n[00:02.00]Translation\n[00:04.00]<b>只是歌词文本</b>\n[00:06.00]尾声';
const candidate = (id: number, syncedLyrics: string | null = '[00:00]在线测试\n[00:03]在线第二句') => ({ id, trackName: `测试歌曲 ${id}`, artistName: '测试歌手', albumName: '测试专辑', duration: 7, instrumental: false, syncedLyrics, plainLyrics: '普通歌词' });

async function prepare(page: Page, files = [wav], filename = 'tone.wav') {
  await page.goto('/');
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
  await page.locator('input[type=file]').first().setInputFiles(files);
  await page.getByRole('button', { name: `播放 ${filename}`, exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '歌词', exact: true }).click();
}

async function importLyrics(page: Page, content = lrc) {
  await page.getByRole('button', { name: '导入 .lrc', exact: true }).click();
  await page.getByLabel('歌词文件', { exact: true }).setInputFiles({ name: '测试.lrc', mimeType: 'text/plain', buffer: Buffer.from(content) });
  await page.getByRole('button', { name: '使用这份歌词' }).click();
}

async function seek(page: Page, seconds: number) {
  const slider = page.getByRole('group', { name: '播放进度' }).getByRole('slider');
  await slider.focus(); await slider.press('Home');
  await expect(slider).toBeEnabled();
  for (let i = 0; i < seconds; i++) {
    await slider.focus(); await slider.press('ArrowRight');
    await expect(slider).toBeEnabled(); // WASM seeks prepare a new decode segment.
    await expect(slider).toHaveAttribute('aria-valuenow', String(i + 1));
  }
  await expect(slider).toHaveAttribute('aria-valuenow', String(seconds));
}

test('local LRC previews safely, follows seek/pause, saves offset and restores offline', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await prepare(page);
  await importLyrics(page);
  await expect(page.locator('.lyric-line.is-active')).toHaveText('开场');
  await seek(page, 2);
  await expect(page.locator('.lyric-line.is-active')).toHaveText('第二句Translation');
  await page.getByRole('button', { name: '延后 0.5 秒', exact: true }).click();
  await expect(page.locator('.lyric-line.is-active')).toHaveText('开场');
  await expect(page.getByText('延后 0.5 秒', { exact: true }).first()).toBeVisible();
  await seek(page, 5);
  await expect(page.locator('.lyric-line.is-active')).toHaveText('<b>只是歌词文本</b>');
  await expect(page.locator('.lyric-line b')).toHaveCount(0);
  await page.locator('.lyrics-scroll').dispatchEvent('wheel', { deltaY: 120 });
  await expect(page.getByRole('button', { name: '回到当前歌词' })).toBeVisible();
  await page.getByRole('button', { name: '回到当前歌词' }).click();
  await expect(page.getByRole('button', { name: '回到当前歌词' })).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page.locator('.lyric-line.is-active')).toHaveText('<b>只是歌词文本</b>');
  // The saved library contains the raw lyrics and calibration before reload.
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve) => {
    const request = indexedDB.open('ziyou-music');
    request.onsuccess = () => { const db = request.result; const read = db.transaction('library').objectStore('library').get('state'); read.onsuccess = () => { resolve(read.result?.tracks[0]?.lyrics?.adjustmentMs); db.close(); }; };
  }))).toBe(500);
  await page.route('https://lrclib.net/**', (route) => route.abort());
  await page.reload();
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
  await page.getByRole('button', { name: '歌词', exact: true }).click();
  await expect(page.locator('.lyrics-source')).toContainText('本地导入');
  await expect(page.locator('.lyrics-adjust strong')).toHaveText('延后 0.5 秒');
  await expect(page.locator('.lyrics-scroll')).toContainText('第二句');
  expect(errors).toEqual([]);
});

test('search ranks candidates, previews without replacement, saves selected online lyrics and removes lyrics only', async ({ page }) => {
  await page.route('https://lrclib.net/api/search*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('track_name')).toBe('测试歌曲');
    expect(url.searchParams.get('artist_name')).toBe('测试歌手');
    expect(route.request().headers()['x-user-agent']).toContain('ZiYou');
    expect(route.request().postData()).toBeNull();
    await route.fulfill({ json: [candidate(1, null), candidate(2)] });
  });
  await prepare(page); await importLyrics(page);
  await page.getByRole('button', { name: '联网搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '歌词搜索歌曲名称' }).fill('测试歌曲');
  await page.getByRole('textbox', { name: '歌词搜索歌手' }).fill('测试歌手');
  await page.getByRole('button', { name: '搜索歌词', exact: true }).click();
  await expect(page.locator('.lyrics-result')).toHaveCount(2);
  await expect(page.locator('.lyrics-result').first()).toContainText('测试歌曲 2');
  await page.locator('.lyrics-result').first().click();
  await expect(page.getByText(/确认后将替换/)).toBeVisible();
  await page.getByRole('button', { name: '返回歌词', exact: true }).click();
  await expect(page.locator('.lyrics-scroll')).toContainText('开场');
  await page.getByRole('button', { name: '联网搜索', exact: true }).click();
  await page.locator('.lyrics-result').first().click();
  await page.getByRole('button', { name: '使用这份歌词' }).click();
  await expect(page.locator('.lyrics-source')).toContainText('LRCLIB');
  await expect(page.locator('.lyrics-scroll')).toContainText('在线测试');
  await page.getByRole('button', { name: '移除歌词', exact: true }).click();
  await page.getByRole('button', { name: '确认移除歌词', exact: true }).click();
  await expect(page.getByText('给这首歌添上歌词')).toBeVisible();
  await expect(page.getByRole('button', { name: '播放 tone.wav', exact: true })).toBeVisible();
});

test('cancel and track switch discard pending search, failures keep local lyrics', async ({ page }) => {
  const pending: (() => Promise<void>)[] = [];
  await page.route('https://lrclib.net/api/search*', (route) => {
    pending.push(() => route.fulfill({ json: [candidate(3)] }).catch(() => {}));
  });
  await prepare(page, [wav, flac]); await importLyrics(page);
  await page.getByRole('button', { name: '联网搜索', exact: true }).click();
  await page.getByRole('button', { name: '搜索歌词', exact: true }).click();
  await expect.poll(() => pending.length).toBe(1);
  await page.getByRole('button', { name: '取消搜索', exact: true }).click();
  await pending[0]();
  await expect(page.locator('.lyrics-result')).toHaveCount(0);
  await page.waitForTimeout(550);
  await page.getByRole('button', { name: '搜索歌词', exact: true }).click();
  await expect.poll(() => pending.length).toBe(2);
  await page.getByRole('button', { name: '下一首', exact: true }).click();
  await expect(page.locator('.now-playing strong')).toHaveText('tone.flac');
  await pending[1]();
  await expect(page.getByText('给这首歌添上歌词')).toBeVisible();
  await expect(page.locator('.lyrics-result')).toHaveCount(0);
  await page.getByRole('button', { name: '上一首', exact: true }).click();
  await expect(page.locator('.now-playing strong')).toHaveText('tone.wav');
  await expect(page.locator('.lyrics-scroll')).toContainText('开场');
  await page.unroute('https://lrclib.net/api/search*');
  await page.route('https://lrclib.net/api/search*', (route) => route.abort());
  await page.getByRole('button', { name: '联网搜索', exact: true }).click();
  await page.waitForTimeout(550); // Respect the provider's inter-request cooldown.
  await page.getByRole('button', { name: '搜索歌词', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无法连接歌词服务');
  await page.getByRole('button', { name: '返回歌词', exact: true }).click();
  await expect(page.locator('.lyrics-scroll')).toContainText('开场');
});

test('DSF lyrics follow the WASM playback clock and paused seeks', async ({ page }) => {
  await prepare(page, [path.resolve('tests/fixtures/tone.dsf')], 'tone.dsf');
  await importLyrics(page);
  await seek(page, 3);
  await expect(page.locator('.lyric-line.is-active')).toHaveText('第二句Translation');
  await seek(page, 0);
  await expect(page.locator('.lyric-line.is-active')).toHaveText('开场');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.locator('.lyric-line.is-active')).toHaveText('第二句Translation', { timeout: 8000 });
  await page.getByRole('button', { name: '暂停', exact: true }).click();
});

test('plain/invalid local lyrics degrade clearly and removing music removes associated lyrics', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: '导入 .lrc', exact: true }).click();
  await page.getByLabel('歌词文件', { exact: true }).setInputFiles({ name: 'empty.lrc', mimeType: 'text/plain', buffer: Buffer.from('[ti:只有标题]') });
  await expect(page.getByRole('alert')).toContainText('没有可显示的歌词');
  await page.getByLabel('歌词文件', { exact: true }).setInputFiles({ name: 'plain.lrc', mimeType: 'text/plain', buffer: Buffer.from('没有时间标记\n第二句') });
  await page.getByRole('button', { name: '使用这份歌词' }).click();
  await expect(page.getByText('这份歌词没有时间标记，可阅读，暂不跟随播放高亮。')).toBeVisible();
  await expect(page.getByRole('button', { name: '提前 0.5 秒' })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭歌词' }).click();
  await page.getByRole('button', { name: 'tone.wav 的操作' }).click();
  await page.getByRole('menuitem', { name: '从音乐库移除', exact: true }).click();
  await page.getByRole('button', { name: '确认移除', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放 tone.wav', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve) => {
    const request = indexedDB.open('ziyou-music'); request.onsuccess = () => { const db = request.result; const read = db.transaction('library').objectStore('library').get('state'); read.onsuccess = () => { resolve(read.result?.tracks.length); db.close(); }; };
  }))).toBe(0);
});
