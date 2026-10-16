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
import { KeyStore, modelKey } from '../src/main/llm/keys';
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
test('packaged builds ignore the environment key; development falls back to it', async () => {
  const empty = new KeyStore(await mkdtemp(join(tmpdir(), 'vivid-keys-')));
  const stored = new KeyStore(await mkdtemp(join(tmpdir(), 'vivid-keys-')));
  await stored.set('synthetic-test-secret');
  vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-env-secret');
  try {
    expect(await modelKey(empty, false)).toBe('synthetic-env-secret');
    expect(await modelKey(empty, true)).toBeUndefined();
    expect(await modelKey(stored, false)).toBe('synthetic-test-secret');
    expect(await modelKey(stored, true)).toBe('synthetic-test-secret');
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    expect(await modelKey(empty, false)).toBeUndefined();
  } finally {
    vi.unstubAllEnvs();
  }
});
