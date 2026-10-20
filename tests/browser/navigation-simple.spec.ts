import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:1420' });
test('simplified navigation keeps categories usable and removes score entry', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
  await page.goto('/desktop.html');
  await expect(page.getByTestId('library-ready')).toHaveText('ready');
  const navigation = page.locator('.flow-navigation');
  await expect(page.getByText('找谱与练习', { exact: true })).toHaveCount(0);
  await expect(navigation.getByRole('button', { name: /^歌手/ })).toBeVisible();
  await navigation.getByRole('button', { name: /^歌手/ }).click();
  await expect(page.getByRole('heading', { name: '歌手', exact: true })).toBeVisible();
  await navigation.getByText('我的分类', { exact: true }).click();
  await navigation.getByRole('button', { name: '新建分类', exact: true }).click();
  await page.getByRole('textbox', { name: '分类名称' }).fill('夜间收藏');
  await page.getByRole('button', { name: '创建分类', exact: true }).click();
  await expect(page.getByRole('heading', { name: /夜间收藏/ })).toBeVisible();
  await navigation.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '音乐文件夹', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('尚未绑定目录。首次选择后，音乐文件仍保留在原位置。')).toBeVisible();
});
