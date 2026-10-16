import { test, expect, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const storage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn(() => Buffer.from([0, 17, 99, 32])),
  decryptString: vi.fn(() => 'synthetic-test-secret'),
}));
vi.mock('electron', () => ({ safeStorage: storage }));
import { KeyStore } from '../src/main/llm/keys';
test('stores only safeStorage ciphertext and supports status and clear', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vivid-keys-'));
  const keys = new KeyStore(dir);
  expect(await keys.has()).toBe(false);
  await keys.set('synthetic-test-secret');
  expect(storage.encryptString).toHaveBeenCalledWith('synthetic-test-secret');
  expect(await readFile(join(dir, 'deepseek.enc'))).toEqual(
    Buffer.from([0, 17, 99, 32]),
  );
  expect(await keys.has()).toBe(true);
  expect(await keys.get()).toBe('synthetic-test-secret');
  await keys.clear();
  expect(await keys.has()).toBe(false);
  storage.isEncryptionAvailable.mockReturnValueOnce(false);
  await expect(keys.set('synthetic-test-secret')).rejects.toThrow(
    'unavailable',
  );
  expect(await keys.has()).toBe(false);
});
