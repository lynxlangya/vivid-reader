import { ipcMain, dialog, app } from 'electron';
import { Value } from 'typebox/value';
import type { TSchema } from 'typebox';
import { EmptySchema, ApiKeySchema, PositionSchema } from '../../shared/ipc';
import { BookStore } from '../content/book-store';
import { KeyStore } from '../llm/keys';
export function registerIPC() {
  const books = new BookStore(app.getPath('userData'));
  const keys = new KeyStore(app.getPath('userData'));
  const handle = (
    channel: string,
    schema: TSchema,
    fn: (payload: unknown) => unknown,
  ) =>
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (event.senderFrame !== event.sender.mainFrame)
        throw new Error('Untrusted IPC sender');
      if (!Value.Check(schema, payload)) throw new Error('Invalid IPC payload');
      return fn(payload);
    });
  handle('vivid:ping', EmptySchema, () => '历历');
  handle('vivid:import', EmptySchema, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'EPUB', extensions: ['epub'] }],
    });
    return result.canceled ? null : books.import(result.filePaths[0]);
  });
  handle('vivid:restore', EmptySchema, () => books.restore());
  handle('vivid:position', PositionSchema, (payload) =>
    books.savePosition((payload as { cfi: string }).cfi),
  );
  handle('vivid:set-key', ApiKeySchema, (payload) =>
    keys.set((payload as { value: string }).value),
  );
  handle('vivid:has-key', EmptySchema, () => keys.has());
  handle('vivid:clear-key', EmptySchema, () => keys.clear());
}
