import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openRepository } from '../db/repository';
import { BookStore } from '../content/book-store';
import { completeText } from '../llm/model';
import { WikidataClient } from '../wikidata/client';
import { runPipeline } from './pipeline';
import { writeM1Report } from './report';
export async function runReportCLI(userData: string, packaged: boolean) {
  const repo = openRepository(join(userData, 'vivid.sqlite'));
  try {
    if (process.argv.includes('--preprocess')) {
      // Packaged builds never read model keys from the environment.
      const apiKey = packaged ? undefined : process.env.DEEPSEEK_API_KEY;
      if (process.env.VIVID_TEST_EPUB && apiKey) {
        const book = await new BookStore(userData).import(
          process.env.VIVID_TEST_EPUB,
        );
        await runPipeline(
          repo,
          {
            id: book.id,
            path: join(userData, 'books', `${book.id}.epub`),
            bytes: await readFile(process.env.VIVID_TEST_EPUB),
          },
          (context) => completeText(context, apiKey),
          new WikidataClient(repo),
          { limit: 2 },
        );
      } else console.info('未实跑：缺少真实测试书或模型环境变量。');
    }
    const result = await writeM1Report(repo, repo.books()[0]?.id, userData);
    console.info(JSON.stringify(result));
  } finally {
    repo.close();
  }
}
