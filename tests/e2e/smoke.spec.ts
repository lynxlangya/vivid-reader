import { launchIsolated, capture } from './helpers';
import { test, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('opens the secure reader window', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'vivid-e2e-'));
  const app = await launchIsolated(userData);
  try {
    const page = await app.firstWindow();
    await expect(page).toHaveTitle('历历');
    await expect(
      page.getByRole('heading', { name: '书架', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => 'require' in window)).toBe(false);
    expect(await page.evaluate(() => window.vivid.ping({}))).toBe('历历');
    await expect(
      page.evaluate(() => window.vivid.ping({ unexpected: true } as never)),
    ).rejects.toThrow('Invalid IPC payload');
    await expect(
      page.getByRole('button', { name: '开发核对', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.evaluate(() => window.vivid.reviewEntities()),
    ).rejects.toThrow('development-only');
    await capture(app, page, '/tmp/vivid-g0-reader.png');
  } finally {
    await app.close();
  }
});
