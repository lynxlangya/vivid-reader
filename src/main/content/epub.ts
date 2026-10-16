import { unzipSync, strFromU8 } from 'fflate';
import { DOMParser } from 'linkedom';
import { posix } from 'node:path';
import * as CFI from '../../renderer/vendor/foliate-js/epubcfi.js';
import type { Chapter, TextRun } from '../../shared/book';
export interface ParsedBook {
  title: string;
  author: string;
  chapters: Chapter[];
}
const parse = (xml: string) =>
  new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
const unwrap = (value: string) => value.slice(8, -1);
export function parseEpub(bytes: Uint8Array): ParsedBook {
  const files = unzipSync(bytes);
  const load = (path: string) => {
    if (!files[path]) throw new Error('Missing EPUB resource');
    return strFromU8(files[path]);
  };
  const container = parse(load('META-INF/container.xml'));
  const opfPath = container
    .querySelector('rootfile')
    ?.getAttribute('full-path');
  if (!opfPath) throw new Error('Invalid EPUB container');
  const opf = parse(load(opfPath));
  const spine = Array.from(opf.querySelectorAll('spine > itemref'));
  const bases = CFI.fromElements(spine);
  const chapters = spine.map((item, index) => {
    const manifest = Array.from(opf.querySelectorAll('manifest > item')).find(
      (x) => x.getAttribute('id') === item.getAttribute('idref'),
    );
    const href = posix.normalize(
      posix.join(
        posix.dirname(opfPath),
        decodeURIComponent(manifest?.getAttribute('href') ?? ''),
      ),
    );
    const doc = parse(load(href));
    const body = doc.querySelector('body');
    if (!body) throw new Error('Missing chapter body');
    let text = '';
    const runs: TextRun[] = [];
    const blocks: number[] = [];
    function walk(node: Node) {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3 || child.nodeType === 4) {
          const value = child.nodeValue ?? '';
          if (!value) continue;
          const local = CFI.fromRange(
            {
              startContainer: child,
              startOffset: 0,
              endContainer: child,
              endOffset: 0,
              collapsed: true,
            },
            undefined,
          );
          runs.push({
            start: text.length,
            end: text.length + value.length,
            cfi: CFI.joinIndir(bases[index], local),
          });
          text += value;
        } else if (
          child.nodeType === 1 &&
          !['script', 'style', 'noscript'].includes(
            child.nodeName.toLowerCase(),
          )
        ) {
          walk(child);
          if (
            ['p', 'h1', 'h2', 'h3', 'li', 'dd', 'dt', 'blockquote'].includes(
              child.nodeName.toLowerCase(),
            )
          )
            blocks.push(text.length);
        }
      }
    }
    walk(body);
    const bodyCFI = CFI.fromRange(
      {
        startContainer: body,
        startOffset: 0,
        endContainer: body,
        endOffset: 0,
        collapsed: true,
      },
      undefined,
    );
    return {
      id: String(index),
      index,
      href,
      title: doc.querySelector('title')?.textContent ?? `第${index + 1}章`,
      baseCFI: bases[index],
      bodyPath: unwrap(bodyCFI),
      text,
      runs,
      blocks,
    };
  });
  return {
    title: opf.getElementsByTagName('dc:title')[0]?.textContent ?? '未命名',
    author: opf.getElementsByTagName('dc:creator')[0]?.textContent ?? '',
    chapters,
  };
}
export function cfiAt(chapter: Chapter, offset: number): string {
  if (!Number.isInteger(offset) || offset < 0 || offset > chapter.text.length)
    throw new Error('Offset outside chapter');
  if (!chapter.runs.length)
    return CFI.joinIndir(chapter.baseCFI, `epubcfi(${chapter.bodyPath})`);
  const run =
    chapter.runs.find((x) => offset >= x.start && offset < x.end) ??
    (offset === chapter.text.length ? chapter.runs.at(-1) : undefined);
  if (!run) throw new Error('No text at offset');
  return run.cfi.replace(
    /:(\d+)\)$/,
    (_, base: string) => `:${Number(base) + offset - run.start})`,
  );
}
export function cfiRangeAt(
  chapter: Chapter,
  start: number,
  end: number,
): string {
  if (end < start) throw new Error('Invalid text range');
  if (start === end) return cfiAt(chapter, start);
  const local = (offset: number) =>
    unwrap(cfiAt(chapter, offset))
      .split('!')
      .at(-1)!
      .slice(chapter.bodyPath.length);
  return `epubcfi(${unwrap(chapter.baseCFI)}!${chapter.bodyPath},${local(start)},${local(end)})`;
}
export function sampleOffsets(book: ParsedBook, count = 200) {
  const chapters = book.chapters.filter((chapter) => chapter.text.length);
  if (!chapters.length) return [];
  let seed = 7411;
  return Array.from({ length: count }, (_, i) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const chapter = chapters[i % chapters.length];
    const offset = seed % chapter.text.length;
    return {
      cfi: cfiRangeAt(chapter, offset, offset + 1),
      expected: chapter.text.slice(offset, offset + 1),
    };
  });
}
