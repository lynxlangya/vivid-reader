import { ipcMain } from 'electron';
import { Value } from 'typebox/value';
import { PingSchema } from '../../shared/ipc';
export function registerIPC() {
  ipcMain.handle('vivid:ping', (_event, payload: unknown) => {
    if (!Value.Check(PingSchema, payload))
      throw new Error('Invalid IPC payload');
    return '历历';
  });
}
