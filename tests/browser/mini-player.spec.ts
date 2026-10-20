import { test, expect } from '@playwright/test';
test.use({
  baseURL: 'http://127.0.0.1:1420',
  viewport: { width: 360, height: 220 },
});
test('mini controls use one command bridge and fit the minimum size', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const callbacks = new Map<number, (payload: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    let id = 0;
    const w = window as unknown as Record<string, unknown>;
    w.commands = [];
    const deliver = (event: string, payload: unknown) =>
      listeners.forEach((l, key) => {
        if (l.event === event)
          callbacks.get(l.handler)?.({ event, id: key, payload });
      });
    w.deliver = deliver;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_e: string, key: number) => listeners.delete(key),
    };
    w.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: 'mini' },
        currentWebview: { label: 'mini' },
      },
      transformCallback: (cb: (p: unknown) => void) => {
        callbacks.set(++id, cb);
        return id;
      },
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        (w.commands as unknown[]).push({ cmd, args });
        if (cmd === 'plugin:event|listen') {
          const key = ++id;
          listeners.set(key, {
            event: args.event as string,
            handler: args.handler as number,
          });
          return key;
        }
        if (cmd === 'plugin:event|unlisten') {
          listeners.delete(args.eventId as number);
          return;
        }
        if (cmd === 'mini_preferences' || cmd === 'mini_save_preferences')
          return { mode: 'both', pinned: args.pinned ?? true, collapsedStyle: args.collapsedStyle ?? 'edge-tab', collapsedActive: false };
        if (cmd === 'mini_collapse' || cmd === 'mini_expand')
          return { mode: 'both', pinned: true, collapsedStyle: cmd === 'mini_collapse' ? args.style : 'edge-tab', collapsedActive: cmd === 'mini_collapse' };
        if (
          cmd === 'plugin:event|emit_to' &&
          args.event === 'ziyou:mini-request'
        )
          deliver('ziyou:mini-state', {
            trackId: 'one',
            name: 'Sample Song.flac',
            playing: true,
            preparing: false,
            position: 21,
            duration: 521,
            volume: 70,
            canPlay: true,
            canSkip: true,
            version: 'original',
            dark: true,
            accent: '#b8d796',
            accentText: '#111',
            language: 'zh-CN',
            message: '',
          });
      },
    };
  });
  await page.goto('/mini.html');
  await expect(page.getByText('Sample Song.flac')).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '下一首', exact: true }).click();
  await page.getByRole('button', { name: '显示模式', exact: true }).click();
  await expect(page.getByRole('button', { name: '专辑封面方块', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '显示模式', exact: true }).click();
  await expect(page.getByRole('button', { name: '专辑封面方块', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '显示模式', exact: true }).click();
  await page.getByRole('button', { name: '专辑封面方块', exact: true }).click();
  await expect(page.getByRole('button', { name: '专辑封面方块', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '收起迷你播放器', exact: true }).click();
  await expect(page.getByRole('button', { name: '展开迷你播放器' })).toBeVisible();
  await expect(page.locator('.mini-player')).toHaveClass(/cover-tile/);
  const tile = await page.getByRole('button', { name: '展开迷你播放器' }).boundingBox();
  expect(tile).not.toBeNull();
  await page.mouse.move(tile!.x + tile!.width / 2, tile!.y + tile!.height / 2);
  await page.mouse.down();
  await page.mouse.move(tile!.x + tile!.width / 2 + 32, tile!.y + tile!.height / 2 + 20);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: '展开迷你播放器' })).toBeVisible();
  await page.getByRole('button', { name: '展开迷你播放器' }).click();
  await expect(page.locator('.mini-volume')).toBeVisible();
  await page.getByRole('button', { name: '显示模式', exact: true }).click();
  await page.getByRole('button', { name: '仅迷你播放器', exact: true }).click();
  await page.getByRole('button', { name: '返回主界面', exact: true }).click();
  const commands = await page.evaluate(
    () =>
      (
        window as unknown as {
          commands: {
            cmd: string;
            args: { event?: string; payload?: unknown };
          }[];
        }
      ).commands,
  );
  expect(
    commands
      .filter((c) => c.args.event === 'ziyou:mini-action')
      .map((c) => c.args.payload),
  ).toEqual([
    { type: 'toggle' },
    { type: 'next' },
    { type: 'mode', value: 'mini-only' },
  ]);
  expect(commands.some((c) => c.cmd === 'mini_restore_main')).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    360,
  );
  const footer = await page.locator('.mini-volume').boundingBox();
  expect(footer).not.toBeNull();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(220);
  expect(errors).toEqual([]);
});
