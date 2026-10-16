import { zipSync, strToU8 } from 'fflate';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
export const syntheticParagraphs = [
  '沿着纸上的河流，旅人走进了纸湾。纸湾旁的木桥连接着两片田野。行者阿林记下了风向。',
  '山坡上的谷物随着季节变化。我们在这里观察种子的形状，比较两块土地的收成。',
  '阅读像一次缓慢的散步。每一步留下的线索，都要放回已经走过的道路上理解。',
  'SENTINEL-AFTER-BOUNDARY-4。后文地点雾岛只在此处出现。',
  'SENTINEL-AFTER-BOUNDARY-5。后文人物远客只在此处出现。',
];
export async function buildEpub() {
  const dir = await mkdtemp(join(tmpdir(), 'vivid-fixture-'));
  const entries: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
  };
  entries['META-INF/container.xml'] = strToU8(
    '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  entries['EPUB/package.opf'] = strToU8(
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">vivid-synthetic</dc:identifier><dc:title>纸上行旅</dc:title><dc:creator>合成测试</dc:creator><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2026-10-16T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
      syntheticParagraphs
        .map(
          (_, i) =>
            `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`,
        )
        .join('') +
      '</manifest><spine>' +
      syntheticParagraphs.map((_, i) => `<itemref idref="c${i}"/>`).join('') +
      '</spine></package>',
  );
  entries['EPUB/nav.xhtml'] = strToU8(
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>' +
      syntheticParagraphs
        .map((_, i) => `<li><a href="c${i}.xhtml">第${i + 1}章</a></li>`)
        .join('') +
      '</ol></nav></body></html>',
  );
  syntheticParagraphs.forEach((text, i) => {
    entries[`EPUB/c${i}.xhtml`] = strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第${i + 1}章</title><script>globalThis.vividBookScriptExecuted=true;top.vividBookScriptExecuted=true</script></head><body><h1>第${i + 1}章</h1>${Array.from({ length: 16 }, () => `<p>${text}</p>`).join('')}<p>复杂<em>内联</em>文字 &amp; 空格。😀</p></body></html>`,
    );
  });
  const path = join(dir, 'synthetic.epub');
  await writeFile(path, zipSync(entries, { level: 0 }));
  return path;
}
