import { app, BrowserWindow, session } from 'electron';
import { join } from 'node:path';
import { registerIPC } from './ipc';
import { runReportCLI } from './pipeline/report-cli';
app.setName('Vivid');
if (process.env.VIVID_USER_DATA)
  app.setPath('userData', process.env.VIVID_USER_DATA);
async function createWindow() {
  const win = new BrowserWindow({
    title: '历历',
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#F6F3EC',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (process.env.ELECTRON_RENDERER_URL)
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  if (process.argv.includes('--report-m1')) {
    try {
      await runReportCLI(app.getPath('userData'));
      app.exit(0);
    } catch {
      console.error('M1 report failed. No book data was logged.');
      app.exit(1);
    }
    return;
  }
  registerIPC();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
