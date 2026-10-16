import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openRepository } from '../../src/main/db/repository';
import { parseEpub, cfiAt } from '../../src/main/content/epub';
import { ContentGateway } from '../../src/main/content/gateway';
import { locateMentions } from '../../src/main/pipeline/mentions';
import { mergeExtractions } from '../../src/main/pipeline/pipeline';
import { buildEpub } from './build-epub';
export async function contentFixture() {
  const bytes = await readFile(await buildEpub());
  const parsed = parseEpub(bytes);
  const id = createHash('sha256').update(bytes).digest('hex');
  const repo = openRepository(':memory:');
  repo.putBook({
    id,
    title: parsed.title,
    author: parsed.author,
    path: 'synthetic',
  });
  parsed.chapters.forEach((chapter) => repo.putChapter(id, chapter));
  const records = [
    {
      surface: '纸湾',
      type: 'place' as const,
      original_name_guess: 'Synthetic Bay',
      aliases_in_text: ['纸湾旁'],
      importance: 0.95,
      note: 'PRIVATE-EXTRACTION-NOTE',
    },
    {
      surface: '阿林',
      type: 'person' as const,
      original_name_guess: 'Synthetic Reader',
      aliases_in_text: [],
      importance: 0.8,
      note: 'PRIVATE-EXTRACTION-NOTE',
    },
    {
      surface: '后文地点雾岛',
      type: 'place' as const,
      original_name_guess: '',
      aliases_in_text: [],
      importance: 0.9,
      note: 'PRIVATE-EXTRACTION-NOTE',
    },
    {
      surface: '后文人物远客',
      type: 'person' as const,
      original_name_guess: '',
      aliases_in_text: [],
      importance: 0.9,
      note: 'PRIVATE-EXTRACTION-NOTE',
    },
  ];
  const entities = mergeExtractions(
    id,
    records.map((entity, index) => ({
      chapter: index < 2 ? 0 : index + 1,
      entity,
    })),
  );
  entities.forEach((entity) => repo.putEntity(entity));
  const chapters = repo.chapters(id);
  chapters.forEach((chapter) =>
    repo.replaceMentions(chapter.id, locateMentions(chapter, entities)),
  );
  const boundary = cfiAt(chapters[2], Math.floor(chapters[2].text.length / 2));
  repo.saveProgress(id, cfiAt(chapters[2], 0), boundary);
  return {
    repo,
    id,
    chapters,
    entities,
    gateway: new ContentGateway(repo, id),
  };
}
