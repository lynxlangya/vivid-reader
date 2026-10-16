import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, rename } from 'node:fs/promises';
import { join, extname, resolve, relative, isAbsolute } from 'node:path';
import { parseEpub } from './epub';

import { validateCFI } from '../../shared/cfi';
export interface StoredBook {
  id: string;
  title: string;
  author: string;
  bytes: Uint8Array;
  currentCFI?: string;
}
interface Index {
  id: string;
  currentCFI?: string;
}
export class BookStore {
  private index?: Index;
  private writing: Promise<void> = Promise.resolve();
  constructor(readonly dir: string) {}
  async import(path: string): Promise<StoredBook> {
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
  async open(): Promise<StoredBook> {
    if (!this.index)
      this.index = JSON.parse(
        await readFile(join(this.dir, 'reader.json'), 'utf8'),
      ) as Index;
    const bytes = await readFile(
      join(this.dir, 'books', `${this.index!.id}.epub`),
    );
    const book = parseEpub(bytes);
    return {
      id: this.index!.id,
      title: book.title,
      author: book.author,
      bytes,
      currentCFI: this.index!.currentCFI,
    };
  }
  async select(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid book');
    this.index = { id };
    await this.persist();
    return this.open();
  }
  async restore(): Promise<StoredBook | null> {
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
