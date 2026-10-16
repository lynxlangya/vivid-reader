import { test, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openRepository } from '../src/main/db/repository';
import { runPipeline } from '../src/main/pipeline/pipeline';
import { writeM1Report } from '../src/main/pipeline/report';
import { WikidataClient } from '../src/main/wikidata/client';
import { buildEpub } from './fixtures/build-epub';
import { fakeModel } from './fixtures/faux-model';
import entities from './fixtures/wikidata-entities.json';
import search from './fixtures/wikidata-search.json';
import countries from './fixtures/wikidata-countries.json';
test('writes a numeric M1 report outside the repository with manual accuracy still pending', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vivid-m1-report-'));
  const path = await buildEpub();
  const bytes = await readFile(path);
  const id = createHash('sha256').update(bytes).digest('hex');
  const repo = openRepository(join(dir, 'vivid.sqlite'));
  try {
    const extraction = JSON.stringify({
      entities: [
        {
          surface: '纸湾',
          type: 'place',
          original_name_guess: 'Berlin',
          aliases_in_text: [],
          importance: 0.9,
          note: 'PRIVATE-EXTRACTION-NOTE',
        },
      ],
    });
    const model = fakeModel([extraction, extraction]);
    const wiki = new WikidataClient(
      repo,
      async (value) => {
        const params = new URL(String(value)).searchParams;
        if (params.get('action') === 'wbsearchentities')
          return Response.json({ search: search.search.slice(0, 1) });
        if (params.get('props') === 'labels') return Response.json(countries);
        return Response.json({ entities: { Q64: entities.entities.Q64 } });
      },
      async () => {},
    );
    await runPipeline(repo, { id, path, bytes }, model.complete, wiki, {
      limit: 2,
    });
    const result = await writeM1Report(repo, id, dir);
    const json = await readFile(result.path, 'utf8');
    expect(JSON.parse(json)).toEqual(result.report);
    expect(json).not.toContain('纸湾');
    expect(json).not.toContain('PRIVATE-EXTRACTION-NOTE');
    expect(result.report.linkAccuracy).toBe('待人工核对');
    expect(result.report.extracted).toBe(1);
    expect(result.report.linked).toBe(1);
    await writeFile('/tmp/vivid-g2-artifact-dir.txt', dir);
    console.info('Synthetic M1 summary', JSON.stringify(result.report));
  } finally {
    repo.close();
  }
});
