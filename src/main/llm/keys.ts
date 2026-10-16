import { safeStorage } from 'electron';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
export class KeyStore {
  constructor(private dir: string) {}
  private path() {
    return join(this.dir, 'deepseek.enc');
  }
  async set(value: string) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('System key storage is unavailable');
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(), safeStorage.encryptString(value), {
      mode: 0o600,
    });
  }
  async has() {
    try {
      await readFile(this.path());
      return true;
    } catch {
      return false;
    }
  }
  async clear() {
    try {
      await unlink(this.path());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  async get() {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('System key storage is unavailable');
    try {
      return safeStorage.decryptString(await readFile(this.path()));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error('Unable to unlock model credentials', { cause: error });
    }
  }
}
