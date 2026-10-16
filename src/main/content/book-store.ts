import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, rename } from 'node:fs/promises';
import { join, extname, resolve, relative, isAbsolute } from 'node:path';
import { parseEpub, cfiAt } from './epub';
import type { OpenBook, ProbeMark } from '../../shared/book';
import { validateCFI } from '../../shared/cfi';
interface Index {
  id: string;
  currentCFI?: string;
}
export class BookStore {
  private index?: Index;
  private writing: Promise<void> = Promise.resolve();
  constructor(readonly dir: string) {}
  async import(path: string): Promise<OpenBook> {
    if (extname(path).toLowerCase() !== '.epub')
      throw new Error('Only EPUB is supported');
    const repo = resolve(process.cwd());
    const rel = relative(repo, resolve(path));
    if (!rel.startsWith('..') && !isAbsolute(rel))
      throw new Error('Keep test books outside the repository');
    const bytes = await readFile(path);
    parseEpub(bytes);
    const id = createHash('sha256').update(bytes).digest('hex');
    await mkdir(join(this.dir, 'books'), { recursive: true });
    await copyFile(path, join(this.dir, 'books', `${id}.epub`));
    this.index = { id };
    await this.persist();
    return this.open();
  }
  private persist() {
    const data = JSON.stringify(this.index);
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await mkdir(this.dir, { recursive: true });
        await writeFile(join(this.dir, 'reader.json.tmp'), data);
        await rename(
          join(this.dir, 'reader.json.tmp'),
          join(this.dir, 'reader.json'),
        );
      });
    return this.writing;
  }
  async open(): Promise<OpenBook> {
    if (!this.index)
      this.index = JSON.parse(
        await readFile(join(this.dir, 'reader.json'), 'utf8'),
      ) as Index;
    const bytes = await readFile(
      join(this.dir, 'books', `${this.index!.id}.epub`),
    );
    const book = parseEpub(bytes);
    const chapter = book.chapters[0];
    const marks: ProbeMark[] = [];
    for (const [name, type] of [
      ['纸湾', 'place'],
      ['阿林', 'person'],
    ] as const) {
      const offset = chapter.text.indexOf(name);
      if (offset >= 0)
        marks.push({
          name,
          type,
          chapter: 0,
          startCFI: cfiAt(chapter, offset),
          endCFI: cfiAt(chapter, offset + name.length),
        });
    }
    return {
      id: this.index!.id,
      title: book.title,
      author: book.author,
      bytes,
      currentCFI: this.index!.currentCFI,
      marks,
    };
  }
  async restore(): Promise<OpenBook | null> {
    try {
      return await this.open();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('Unable to reopen the book', { cause: error });
    }
  }
  async savePosition(cfi: string) {
    validateCFI(cfi);
    if (!this.index) throw new Error('No open book');
    this.index.currentCFI = cfi;
    await this.persist();
  }
}
