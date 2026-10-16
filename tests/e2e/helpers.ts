import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export async function launchIsolated(
  userData: string,
  extra: Record<string, string> = {},
  cwd?: string,
) {
  const app = await electron.launch({
    args: [resolve('out/main/index.js')],
    ...(cwd ? { cwd } : {}),
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: '',
      ...extra,
      VIVID_USER_DATA: userData,
    },
  });
  await app.firstWindow();
  // Keep desktop pointer input from cancelling CDP hover actions.
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setBackgroundThrottling(false);
      window.setIgnoreMouseEvents(true);
      window.hide();
    }
  });
  return app;
}

export async function capture(
  app: ElectronApplication,
  page: Page,
  path: string,
) {
  await page.locator('.glimpse-card').evaluateAll(async (cards) => {
    await Promise.all(
      cards.flatMap((card) =>
        card
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
  });
  const window = await app.browserWindow(page);
  const png = await window.evaluate(async (window) =>
    (
      await window.webContents.capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      })
    )
      .toPNG()
      .toString('base64'),
  );
  await writeFile(path, Buffer.from(png, 'base64'));
}
