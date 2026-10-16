import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { seedReading } from './seed';
import { launchIsolated, capture } from './helpers';
import type { FoliateView } from '../../src/renderer/reader/engine';
async function hoverMark(page: Page) {
  const frame = page.frames().find((f) => f.url().startsWith('blob:'))!;
  await frame.locator('p').first().hover();
  const point = await page.evaluate(() => {
    const view = document.querySelector('foliate-view') as FoliateView;
    const doc = view.renderer.getContents()[0].doc;
    const win = doc.defaultView as unknown as { CSS: typeof CSS };
    const range = [...win.CSS.highlights.get('vivid-place')!][0] as Range;
    const r = range.getBoundingClientRect(),
      f = doc.defaultView!.frameElement!.getBoundingClientRect();
    return {
      x: r.left + f.left + r.width / 4,
      y: r.top + f.top + r.height / 2,
    };
  });
  await page.mouse.move(20, 40);
  await page.waitForTimeout(220);
  await page.evaluate(() => {
    const data = { start: 0, mountedMs: 0, visibleMs: 0 };
    (window as unknown as { hoverMetrics: typeof data }).hoverMetrics = data;
    const view = document.querySelector('foliate-view') as FoliateView;
    const doc = view.renderer.getContents()[0].doc;
    const range = [
      ...(doc.defaultView as unknown as { CSS: typeof CSS }).CSS.highlights.get(
        'vivid-place',
      )!,
    ][0] as Range;
    const move = (event: MouseEvent) => {
      const r = range.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        return;
      data.start = performance.now();
      doc.removeEventListener('mousemove', move);
    };
    doc.addEventListener('mousemove', move);
    const observer = new MutationObserver(() => {
      const card = document.querySelector('.glimpse-card');
      if (!card || !data.start) return;
      data.mountedMs = performance.now() - data.start;
      observer.disconnect();
      const frame = () => {
        if (Number(getComputedStyle(card).opacity) > 0) {
          data.visibleMs = performance.now() - data.start;
        } else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await page.mouse.move(point.x, point.y);
  await expect(page.getByRole('tooltip', { name: '实体旁注' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { hoverMetrics: { visibleMs: number } })
            .hoverMetrics.visibleMs,
      ),
    )
    .toBeGreaterThan(0);
  const metrics = await page.evaluate(
    () =>
      (
        window as unknown as {
          hoverMetrics: { mountedMs: number; visibleMs: number };
        }
      ).hoverMetrics,
  );
  return { point, elapsed: metrics.visibleMs, mounted: metrics.mountedMs };
}
test('margin atlas, night, companion fallback, known state, and jump boundary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vivid-glimpse-e2e-'));
  const { boundary } = await seedReading(dir);
  const app = await launchIsolated(dir);
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.reader-host')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    const { elapsed, mounted } = await hoverMark(page);
    const card = page.getByRole('tooltip');
    await expect(card).toHaveAttribute('data-layout', 'margin');
    await expect(card.getByRole('img')).toBeVisible();
    const metrics = await page.evaluate(() => ({
      card: document
        .querySelector('.glimpse-card')!
        .getBoundingClientRect()
        .toJSON(),
      column: document
        .querySelector('.reader-host')!
        .getBoundingClientRect()
        .toJSON(),
      leader: document.querySelector('.leader path')!.getAttribute('d'),
    }));
    expect(metrics.card.x).toBe(metrics.column.right + 40);
    expect(metrics.leader).toContain(`M${metrics.column.right + 12},`);
    await capture(app, page, '/tmp/vivid-g3-day.png');
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await page.getByRole('button', { name: '切换日夜', exact: true }).click();
    await hoverMark(page);
    await capture(app, page, '/tmp/vivid-g3-night.png');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '伴读', exact: true }).click();
    const fallback = await hoverMark(page);
    await expect(card).toHaveAttribute('data-layout', 'fallback');
    const box = await card.boundingBox();
    expect(
      box!.y > fallback.point.y || box!.y + box!.height < fallback.point.y,
    ).toBe(true);
    await capture(app, page, '/tmp/vivid-g3-fallback.png');
    await card.getByRole('button', { name: '标为已知', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const view = document.querySelector('foliate-view') as FoliateView;
          const doc = view.renderer.getContents()[0].doc;
          return (
            doc.defaultView as unknown as { CSS: typeof CSS }
          ).CSS.highlights.get('vivid-place')!.size;
        }),
      )
      .toBe(0);
    await page.getByRole('button', { name: '目录', exact: true }).click();
    await page.locator('.toc button').nth(3).click();
    await expect(page.locator('.beyond')).toBeVisible();
    await page.waitForTimeout(5100);
    expect(
      (await page.evaluate(() => window.vivid.readerState()))!.boundaryCFI,
    ).toBe(boundary);
    const state = await page.evaluate(() => window.vivid.readerState());
    expect(JSON.stringify(state)).not.toContain('SENTINEL-AFTER');
    expect(state!.marks).toEqual([]);
    expect(state!.toc[3].percent).toBeUndefined();
    await writeFile(
      '/tmp/vivid-g3-performance.json',
      JSON.stringify({
        hoverVisibleMs: elapsed,
        hoverMountedMs: mounted,
        fallbackVisibleMs: fallback.elapsed,
      }),
    );
  } finally {
    await app.close();
  }
});
