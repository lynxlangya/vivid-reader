import { test, expect } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { seedReading } from './seed';
import { launchIsolated, capture } from './helpers';
import type { FoliateView } from '../../src/renderer/reader/engine';
test('library, settings persist, 26px layout, font voices, keyboard annotations and focus mode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vivid-settings-e2e-'));
  await seedReading(dir);
  let app = await launchIsolated(dir);
  try {
    let page = await app.firstWindow();
    await expect(page.locator('.reader-host')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    await page.keyboard.press('Alt');
    const nav = page.getByRole('navigation', { name: '标注导航' });
    await expect(nav).toBeVisible();
    const buttons = nav.getByRole('button');
    await expect(buttons.first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(buttons.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: '实体旁注' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '实体旁注' })).toHaveCount(0);
    await expect(nav).toHaveCount(0);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const prefs = page.getByRole('dialog', { name: '设置' });
    await prefs.getByRole('button', { name: '楷体', exact: true }).click();
    const slider = prefs.getByRole('slider', { name: '字号' });
    await slider.focus();
    await slider.press('End');
    await expect(prefs.getByText('26 px', { exact: true })).toBeVisible();
    await prefs.getByRole('button', { name: '模型', exact: true }).click();
    expect(await prefs.locator('select option').count()).toBeGreaterThan(0);
    await expect(prefs.getByLabel('DeepSeek Key')).toHaveAttribute(
      'type',
      'password',
    );
    await prefs.getByRole('button', { name: '标注', exact: true }).click();
    await prefs.getByRole('checkbox', { name: '地点', exact: false }).uncheck();
    await prefs.getByRole('checkbox', { name: '地点', exact: false }).check();
    await prefs.getByRole('button', { name: '伴读', exact: true }).click();
    await prefs.getByRole('slider', { name: '已读边界', exact: true }).focus();
    await prefs
      .getByRole('slider', { name: '已读边界', exact: true })
      .press('Home');
    await prefs.getByRole('button', { name: '应用边界', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.vivid.readerState()))
            ?.boundaryFraction,
      )
      .toBe(0);
    await prefs.getByRole('button', { name: '关闭设置' }).click();
    await page.getByRole('button', { name: '书架', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '书架', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.book-cover img')).toHaveCount(0);
    await expect(
      page.getByRole('img', { name: '纸上行旅题签封面' }),
    ).toBeVisible();
    await capture(app, page, '/tmp/vivid-g5-library.png');
    await page.locator('.book-open').click();
    await expect(page.locator('.reader-host')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1152, 900),
    );
    const metrics = await page.evaluate(() => {
      const view = document.querySelector('foliate-view') as FoliateView;
      const doc = view.renderer.getContents()[0].doc,
        p = doc.querySelector('p')!,
        style = doc.defaultView!.getComputedStyle(p);
      return {
        size: parseFloat(style.fontSize),
        characters: p.clientWidth / parseFloat(style.fontSize),
        book: style.fontFamily,
        note: getComputedStyle(document.documentElement).getPropertyValue(
          '--voice-note',
        ),
      };
    });
    await writeFile('/tmp/vivid-g5-layout.json', JSON.stringify(metrics));
    expect(metrics.size).toBe(26);
    expect(metrics.characters).toBeGreaterThanOrEqual(24);
    expect(metrics.book).toContain('LXGW');
    expect(metrics.note).toContain('Source Han');

    await page.getByRole('button', { name: '设置', exact: true }).click();
    await prefs.getByRole('button', { name: '伴读', exact: true }).click();
    await prefs.getByRole('switch', { name: '专注模式', exact: true }).check();
    await prefs.getByRole('button', { name: '关闭设置' }).click();
    await expect(page.locator('.progress')).toBeHidden();
    await expect(page.locator('.spine')).toBeHidden();
    await app.close();
    app = await launchIsolated(dir);
    page = await app.firstWindow();
    await expect(page.locator('.reader-host')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    const saved = await page.evaluate(() => window.vivid.preferences());
    expect(saved.fontSize).toBe(26);
    expect(saved.font).toBe('kai');
    expect(saved.focus).toBe(true);
  } finally {
    await app.close();
  }
});
