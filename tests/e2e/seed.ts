import { createServer } from 'vite';
import { resolve, join } from 'node:path';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildEpub } from '../fixtures/build-epub';
import { parseEpub, cfiAt } from '../../src/main/content/epub';
import { locateMentions } from '../../src/main/pipeline/mentions';
import { mergeExtractions } from '../../src/main/pipeline/pipeline';
import type { Repository } from '../../src/main/db/repository';
import type { WikiCandidate } from '../../src/shared/entity';
export async function seedReading(dir: string) {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
  });
  try {
    const { openRepository } = (await server.ssrLoadModule(
      resolve('src/main/db/repository.ts'),
    )) as { openRepository: (path: string) => Repository };
    const file = await buildEpub(),
      bytes = await readFile(file),
      parsed = parseEpub(bytes),
      id = createHash('sha256').update(bytes).digest('hex');
    await mkdir(join(dir, 'books'), { recursive: true });
    await copyFile(file, join(dir, 'books', id + '.epub'));
    await writeFile(
      join(dir, 'reader.json'),
      JSON.stringify({ id, currentCFI: cfiAt(parsed.chapters[0], 0) }),
    );
    const repo = openRepository(join(dir, 'vivid.sqlite'));
    repo.putBook({
      id,
      title: parsed.title,
      author: parsed.author,
      path: file,
    });
    parsed.chapters.forEach((c) => repo.putChapter(id, c));
    const entities = mergeExtractions(id, [
      {
        chapter: 0,
        entity: {
          surface: '纸湾',
          type: 'place',
          original_name_guess: 'Synthetic Bay',
          aliases_in_text: [],
          importance: 0.95,
          note: 'PRIVATE-EXTRACTION-NOTE',
        },
      },
      {
        chapter: 0,
        entity: {
          surface: '阿林',
          type: 'person',
          original_name_guess: 'Synthetic Reader',
          aliases_in_text: [],
          importance: 0.8,
          note: '',
        },
      },
    ]);
    const fact: WikiCandidate = {
      qid: 'Q64',
      label: '柏林',
      original: 'Berlin',
      description: '公开地理测试点',
      lat: 52.52,
      lon: 13.405,
      types: ['Q515'],
      country: '德国',
    };
    entities[0].linked = fact;
    entities[0].candidates = [fact];
    entities[0].status = 'linked';
    entities.forEach((e) => repo.putEntity(e));
    for (const c of repo.chapters(id)) {
      repo.replaceMentions(c.id, locateMentions(c, entities));
      for (const e of entities)
        repo.saveGloss(
          e.id,
          c.id,
          '这里用一处合成地名和一位合成人物，检验阅读与旁注之间的关系。',
          'faux',
        );
    }
    const boundary = cfiAt(
      parsed.chapters[2],
      Math.floor(parsed.chapters[2].text.length / 2),
    );
    repo.saveProgress(id, cfiAt(parsed.chapters[0], 0), boundary);
    repo.close();
    return { file, parsed, id, boundary };
  } finally {
    await server.close();
  }
}
