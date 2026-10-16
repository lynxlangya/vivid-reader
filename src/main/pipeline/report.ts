import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import type { Repository } from '../db/repository';
export async function writeM1Report(
  repo: Repository,
  bookId: string | undefined,
  userData: string,
) {
  const rel = relative(resolve(process.cwd()), resolve(userData));
  if (!rel.startsWith('..') && !isAbsolute(rel))
    throw new Error('Reports must be outside the repository');
  const report = repo.report(bookId ?? '');
  const dir = join(userData, 'reports');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `m1-${bookId ?? 'empty'}-${Date.now()}.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  return { report, path };
}
