import { zipSync, strToU8 } from 'fflate';
import { openRepository } from '../../src/main/db/repository';
import { parseEpub, cfiAt } from '../../src/main/content/epub';
import { ContentGateway } from '../../src/main/content/gateway';
import { locateMentions } from '../../src/main/pipeline/mentions';
import { mergeExtractions } from '../../src/main/pipeline/pipeline';
// Self-authored filler; the generated book never leaves memory.
const filler = '沿着纸上的河流旅人走进了田野木桥连接着两片山坡谷物随季节变化';
export function largeBook({
  chapters = 30,
  paragraphs = 400,
  entities = 300,
} = {}) {
  const names = Array.from(
    { length: entities },
    (_, i) => `地名${String(i).padStart(3, '0')}号`,
  );
  const spine = Array.from({ length: chapters }, (_, i) => i);
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    'EPUB/package.opf': strToU8(
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">vivid-large</dc:identifier><dc:title>纸上长卷</dc:title><dc:creator>合成测试</dc:creator><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2026-10-16T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
        spine
          .map(
            (i) =>
              `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`,
          )
          .join('') +
        '</manifest><spine>' +
        spine.map((i) => `<itemref idref="c${i}"/>`).join('') +
        '</spine></package>',
    ),
    'EPUB/nav.xhtml': strToU8(
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>' +
        spine
          .map((i) => `<li><a href="c${i}.xhtml">第${i + 1}章</a></li>`)
          .join('') +
        '</ol></nav></body></html>',
    ),
  };
  let next = 0;
  for (const i of spine)
    files[`EPUB/c${i}.xhtml`] = strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第${i + 1}章</title></head><body><h1>第${i + 1}章</h1>${Array.from(
        { length: paragraphs },
        () => `<p>${filler}${names[(next++ * 7) % entities]}${filler}</p>`,
      ).join('')}</body></html>`,
    );
  const parsed = parseEpub(zipSync(files, { level: 0 }));
  const repo = openRepository(':memory:'),
    id = 'large';
  repo.putBook({ id, title: parsed.title, author: parsed.author, path: id });
  parsed.chapters.forEach((chapter) => repo.putChapter(id, chapter));
  const records = mergeExtractions(
    id,
    names.map((surface, i) => ({
      chapter: 0,
      entity: {
        surface,
        type: 'place' as const,
        original_name_guess: '',
        aliases_in_text: [],
        importance: 0.5 + (i % 5) / 10,
        note: '',
      },
    })),
  );
  records.forEach((entity) => repo.putEntity(entity));
  const stored = repo.chapters(id);
  stored.forEach((chapter) =>
    repo.replaceMentions(chapter.id, locateMentions(chapter, records)),
  );
  // Read two thirds of the book; the page sits just before the boundary.
  const reading = stored[Math.floor((chapters * 2) / 3)];
  const page = cfiAt(reading, 4000);
  repo.saveProgress(id, page, cfiAt(reading, 8000));
  return {
    repo,
    id,
    chapters: stored,
    page,
    reading,
    gateway: new ContentGateway(repo, id),
  };
}
