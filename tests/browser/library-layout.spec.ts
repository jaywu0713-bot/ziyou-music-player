import { test, expect } from '@playwright/test';
import path from 'node:path';
test.use({
  baseURL: 'http://127.0.0.1:1420',
  viewport: { width: 1280, height: 800 },
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'locks', { value: undefined }),
  );
  await page.goto('/desktop.html');
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
});
test('navigation and player collapse independently, retain playback and restore saved scales', async ({
  page,
}) => {
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(path.resolve('tests/fixtures/tone.wav'));
  await page
    .getByRole('button', { name: '播放 tone.wav', exact: true })
    .click();
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '展开导航栏', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '收起播放栏', exact: true }).click();
  await expect(
    page.locator('.player').getByRole('button', { name: '暂停', exact: true }),
  ).toBeVisible();
  expect(
    (await page.locator('.player-dock').boundingBox())!.height,
  ).toBeLessThan(80);
  await page
    .getByRole('button', { name: '设置', exact: true })
    .first()
    .click();
  await page
    .getByRole('slider', { name: '导航栏缩放', exact: true })
    .fill('120');
  await page
    .getByRole('slider', { name: '播放栏缩放', exact: true })
    .fill('115');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(
    page.getByRole('button', { name: '展开导航栏', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '展开播放栏', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
  await page.getByRole('button', { name: '展开播放栏', exact: true }).click();
  expect(
    (await page.locator('.flow-navigation').boundingBox())!.width,
  ).toBeGreaterThan(290);
  expect(
    (await page.locator('.player-dock').boundingBox())!.height,
  ).toBeGreaterThan(120);
  await page
    .getByRole('button', { name: '设置', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('slider', { name: '导航栏缩放', exact: true }),
  ).toHaveValue('120');
  await expect(
    page.getByRole('slider', { name: '播放栏缩放', exact: true }),
  ).toHaveValue('115');
  await page.getByRole('button', { name: '恢复默认布局', exact: true }).click();
  await expect(
    page.getByRole('slider', { name: '导航栏缩放', exact: true }),
  ).toHaveValue('100');
});
test('main content stays above player at narrow sizes with queue open', async ({
  page,
}) => {
  await page.getByRole('button', { name: '待播放列表', exact: true }).click();
  for (const width of [1280, 820, 600]) {
    await page.setViewportSize({ width, height: 700 });
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await expect
      .poll(async () => {
        const content = (await page
          .locator('.workspace-content')
          .boundingBox())!;
        const dock = (await page.locator('.player-dock').boundingBox())!;
        return content.y + content.height - dock.y;
      })
      .toBeLessThanOrEqual(1);
    await expect(
      page.getByRole('button', { name: '收起播放栏', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '关闭播放列表', exact: true }),
    ).toBeVisible();
  }
});
test('scaling changes icons and occupied space together; albums stay beside navigation', async ({
  page,
}) => {
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(path.resolve('tests/fixtures/tone.wav'));
  const icon = page.locator('.flow-navigation .brand-icon svg');
  const original = (await icon.boundingBox())!.width;
  await page
    .getByRole('button', { name: '设置', exact: true })
    .first()
    .click();
  await page
    .getByRole('slider', { name: '导航栏缩放', exact: true })
    .fill('125');
  await page
    .getByRole('slider', { name: '播放栏缩放', exact: true })
    .fill('125');
  await page.keyboard.press('Escape');
  expect((await icon.boundingBox())!.width).toBeCloseTo(original * 1.25, 0);
  await page
    .getByRole('button', { name: /^专辑/ })
    .first()
    .click();
  const nav = (await page.locator('.flow-navigation').boundingBox())!;
  const card = (await page.locator('.album-card').first().boundingBox())!;
  expect(card.x).toBeGreaterThanOrEqual(nav.x + nav.width);
  await page.screenshot({ path: 'test-results/scaled-albums.png' });
  await page.setViewportSize({ width: 820, height: 700 });
  await page.getByRole('button', { name: '待播放列表', exact: true }).click();
  for (const name of ['歌词', '音频可视化', '待播放列表', '收起播放栏']) {
    const box = (await page
      .getByRole('button', { name, exact: true })
      .boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(820);
  }
  await page.screenshot({ path: 'test-results/scaled-narrow.png' });
  await page.setViewportSize({ width: 1280, height: 800 });
  expect((await icon.boundingBox())!.width).toBeCloseTo(original * 1.25, 0);
});
test('lyrics panel follows the resized and collapsed player edge', async ({
  page,
}) => {
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(path.resolve('tests/fixtures/tone.wav'));
  await page
    .getByRole('button', { name: '播放 tone.wav', exact: true })
    .click();
  await page
    .getByRole('button', { name: '设置', exact: true })
    .first()
    .click();
  await page
    .getByRole('slider', { name: '播放栏缩放', exact: true })
    .fill('125');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '歌词', exact: true }).click();
  const aligned = async () => {
    const panel = (await page.locator('.lyrics-sheet').boundingBox())!;
    const dock = (await page.locator('.player-dock').boundingBox())!;
    return Math.abs(panel.y + panel.height - dock.y);
  };
  await expect.poll(aligned).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '收起播放栏', exact: true }).click();
  await expect.poll(aligned).toBeLessThanOrEqual(1);
});
test('audio position advances without resetting while both regions collapse and expand', async ({
  page,
}) => {
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(path.resolve('tests/fixtures/tone.wav'));
  await page
    .getByRole('button', { name: '播放 tone.wav', exact: true })
    .click();
  const seconds = async () => {
    const text = await page.locator('.seek > span').first().textContent();
    const [m, s] = text!.split(':').map(Number);
    return m * 60 + s;
  };
  await expect.poll(seconds).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  await page.getByRole('button', { name: '收起播放栏', exact: true }).click();
  expect(await seconds()).toBeGreaterThanOrEqual(2);
  await expect.poll(seconds).toBeGreaterThanOrEqual(3);
  await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
  await page.getByRole('button', { name: '展开播放栏', exact: true }).click();
  expect(await seconds()).toBeGreaterThanOrEqual(3);
  await expect.poll(seconds).toBeGreaterThanOrEqual(4);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
});
