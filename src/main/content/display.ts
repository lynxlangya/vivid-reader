import { protocol } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vivid-book',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
export function registerBookDisplay(
  dir: string,
  current: () => string | undefined,
) {
  const capability = randomUUID();
  protocol.handle('vivid-book', async (request) => {
    const url = new URL(request.url);
    const id = current();
    if (
      request.method !== 'GET' ||
      url.hostname !== capability ||
      !id ||
      url.pathname !== `/${id}.epub`
    )
      return new Response(null, { status: 403 });
    const bytes = await readFile(join(dir, 'books', `${id}.epub`));
    return new Response(new Uint8Array(bytes).buffer, {
      headers: {
        'Content-Type': 'application/epub+zip',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  });
  return (id: string) => `vivid-book://${capability}/${id}.epub`;
}
