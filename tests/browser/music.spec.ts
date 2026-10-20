import { test, expect } from '@playwright/test';
import path from 'node:path';
const wav = path.resolve('tests/fixtures/tone.wav'),
  dsf = path.resolve('tests/fixtures/tone.dsf');
test('native file playback, classification persistence and duplicate queue', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
  await expect(
    page.getByRole('button', { name: '导入音乐', exact: true }).first(),
  ).toBeVisible();
  await page.locator('input[type=file]').first().setInputFiles(wav);
  await expect(
    page.getByText('tone.wav', { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '新建分类', exact: true })
    .last()
    .click();
  await page.getByRole('textbox', { name: '分类名称' }).fill('恢复测试');
  await page.getByRole('button', { name: '创建分类', exact: true }).click();
  await page.getByRole('button', { name: /全部音乐/ }).click();
  await page
    .getByRole('checkbox', { name: '选择 tone.wav', exact: true })
    .check();
  await page.getByRole('button', { name: /添加到分类 \(1\)/ }).click();
  await page.getByText('恢复测试', { exact: true }).last().click();
  await page.getByRole('button', { name: '添加到所选分类' }).click();
  await page
    .getByRole('button', { name: '播放 tone.wav', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '暂停', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'tone.wav 的操作' }).click();
  await page.getByRole('menuitem', { name: '下一首播放', exact: true }).click();
  await page.getByRole('button', { name: '待播放列表' }).click();
  const items = page.locator('.queue-items button');
  await expect(items).toHaveCount(2);
  await items.nth(1).click();
  await expect(items.nth(1)).toHaveClass(/accent/);
  await expect(items.nth(0)).not.toHaveClass(/accent/);
  await page.reload();
  await expect(page.getByRole('button', { name: /恢复测试/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '播放', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByText(/这是临时导入的文件/)).toBeVisible();
});
test('DSF local wasm stream decodes, seeks, cancels and reports codec', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
  await page.locator('input[type=file]').first().setInputFiles(dsf);
  await page
    .getByRole('button', { name: '播放 tone.dsf', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '暂停', exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: '播放详情' }).click();
  await expect(page.getByText(/dsd_lsbf/)).toBeVisible();
  await expect(page.getByText(/DSD → PCM/).last()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const slider = page
    .getByRole('group', { name: '播放进度' })
    .getByRole('slider');
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(
    page.getByRole('button', { name: '播放', exact: true }),
  ).toBeVisible({ timeout: 30000 });
  expect(errors).toEqual([]);
});
test('invalid audio reports error and next valid audio still works', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles([path.resolve('tests/fixtures/broken.dsf'), wav]);
  await page
    .getByRole('button', { name: '播放 broken.dsf', exact: true })
    .click();
  await expect(page.getByText(/无法识别此音频/)).toBeVisible({
    timeout: 60000,
  });
  await page
    .getByRole('button', { name: '播放 tone.wav', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '暂停', exact: true }),
  ).toBeVisible();
});
test('directory binding survives reload, refresh preserves missing classifications, permission loss is recoverable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle('music-test', { create: true });
    };
    (FileSystemDirectoryHandle.prototype as any).queryPermission = async () =>
      sessionStorage.getItem('deny') ? 'prompt' : 'granted';
    (FileSystemDirectoryHandle.prototype as any).requestPermission =
      async () => {
        sessionStorage.removeItem('deny');
        return 'granted';
      };
  });
  await page.goto('/');
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('music-test', { create: true });
    const file = await dir.getFileHandle('stored.wav', { create: true });
    const writer = await file.createWritable();
    const samples = 44100;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const text = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++)
        view.setUint8(offset + i, s.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, buffer.byteLength - 8, true);
    text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 44100, true);
    view.setUint32(28, 88200, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, samples * 2, true);
    await writer.write(buffer);
    await writer.close();
  });
  await page.getByRole('button', { name: /音乐文件夹/ }).click();
  await page
    .getByRole('button', { name: '添加音乐文件夹', exact: true })
    .click();
  await expect(
    page.getByText('music-test', { exact: true }).first(),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByText('stored.wav', { exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
  await expect(
    page.getByText('stored.wav', { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '播放 stored.wav' }).click();
  await expect(
    page.getByRole('button', { name: '暂停', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('deny', 'yes'));
  await page.reload();
  await expect(page.getByText(/有音乐文件夹需要重新授权/)).toBeVisible();
  await page.getByRole('button', { name: '恢复访问' }).click();
  await page.getByRole('button', { name: '重新授权', exact: true }).click();
  await expect(page.getByText(/已授权读取/)).toBeVisible();
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('music-test');
    await dir.removeEntry('stored.wav');
  });
  await page.getByRole('button', { name: '刷新音乐库', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('文件暂不可用', { exact: true })).toBeVisible();
  await expect(
    page.getByText('stored.wav', { exact: true }).first(),
  ).toBeVisible();
});
test('switching away cancels decoder work and preserves the new playing track', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
  await page.locator('input[type=file]').first().setInputFiles([dsf, wav]);
  await page
    .getByRole('button', { name: '播放 tone.dsf', exact: true })
    .click();
  await page
    .getByRole('button', { name: '播放 tone.wav', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '暂停', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.now-playing strong')).toHaveText('tone.wav');
  await page
    .getByRole('button', { name: '播放 tone.dsf', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '暂停', exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole('button', { name: '播放 tone.wav', exact: true })
    .click();
  await expect(page.locator('.now-playing strong')).toHaveText('tone.wav');
  await expect(
    page.getByRole('button', { name: '暂停', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '播放', exact: true }),
  ).toBeVisible();
});
test('DSF completes continuously without error and play restarts after end', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
  await page.locator('input[type=file]').first().setInputFiles(dsf);
  await page
    .getByRole('button', { name: '播放 tone.dsf', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '暂停', exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole('button', { name: '播放', exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.seek')).toContainText('0:07');
  await expect(page.locator('.library-banner.warning')).toHaveCount(0);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '暂停', exact: true }),
  ).toBeVisible({ timeout: 30000 });
});

for (const ext of ['flac', 'mp3'])
  test(`${ext} file plays through native path`, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('library-ready')).toHaveText('ready');
    await page
      .locator('input[type=file]')
      .first()
      .setInputFiles(path.resolve(`tests/fixtures/tone.${ext}`));
    await page
      .getByRole('button', { name: `播放 tone.${ext}`, exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: '暂停', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '播放详情' }).click();
    await expect(page.getByText('播放路径：浏览器原生播放')).toBeVisible();
  });
