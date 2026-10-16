import { unzipSync, strFromU8 } from 'fflate';
import { DOMParser } from 'linkedom';
import { posix } from 'node:path';
export function originalCover(bytes: Uint8Array): string | null {
  const files = unzipSync(bytes),
    parser = new DOMParser();
  const container = files['META-INF/container.xml'];
  if (!container) return null;
  const root = parser
    .parseFromString(strFromU8(container), 'text/xml')
    .querySelector('rootfile')
    ?.getAttribute('full-path');
  if (!root || !files[root]) return null;
  const opf = parser.parseFromString(
    strFromU8(files[root]),
    'text/xml',
  ) as unknown as Document;
  const id = opf.querySelector('meta[name="cover"]')?.getAttribute('content');
  const item =
    opf.querySelector('item[properties~="cover-image"]') ??
    (id
      ? Array.from(opf.querySelectorAll('item')).find(
          (x) => x.getAttribute('id') === id,
        )
      : null);
  const href = item?.getAttribute('href'),
    mime = item?.getAttribute('media-type');
  if (!href || !mime || !/^image\/(png|jpeg|webp|gif)$/.test(mime)) return null;
  const data =
    files[
      posix.normalize(
        posix.join(posix.dirname(root), decodeURIComponent(href.split('#')[0])),
      )
    ];
  if (!data || data.length > 5 * 1024 * 1024) return null;
  return `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
}
