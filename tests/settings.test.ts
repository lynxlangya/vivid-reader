import { test, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync, strToU8 } from 'fflate';
import { PreferenceStore } from '../src/main/content/preferences';
import { defaultPreferences } from '../src/shared/settings';
import { originalCover } from '../src/main/content/cover';
import { contentFixture } from './fixtures/content';
import { ContentGateway } from '../src/main/content/gateway';
test('preferences persist and reject untyped secret fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vivid-preferences-'));
  const store = new PreferenceStore(dir);
  const value = {
    ...defaultPreferences,
    font: 'kai' as const,
    fontSize: 26,
    theme: 'night' as const,
  };
  store.set(value);
  expect(new PreferenceStore(dir).get()).toEqual(value);
  expect(() =>
    store.set({ ...value, apiKey: 'synthetic-rejected-value' } as never),
  ).toThrow();
  expect(await readFile(join(dir, 'preferences.json'), 'utf8')).not.toContain(
    'synthetic-rejected-value',
  );
});
test('runtime original cover accepts local raster manifest assets and rejects active SVG', () => {
  const build = (type: string) =>
    zipSync({
      'META-INF/container.xml': strToU8(
        '<container><rootfiles><rootfile full-path="EPUB/package.opf"/></rootfiles></container>',
      ),
      'EPUB/package.opf': strToU8(
        `<package><manifest><item id="cover" properties="cover-image" href="cover.img" media-type="${type}"/></manifest></package>`,
      ),
      'EPUB/cover.img': new Uint8Array([1, 2, 3]),
    });
  expect(originalCover(build('image/png'))).toBe('data:image/png;base64,AQID');
  expect(originalCover(build('image/svg+xml'))).toBeNull();
});
test('preference density/type filters preserve boundary and percentage conversion', async () => {
  const { repo, id, gateway } = await contentFixture();
  try {
    const boundary = gateway.context().boundaryCFI;
    const filtered = new ContentGateway(repo, id, () => ({
      ...defaultPreferences,
      types: ['person'],
      density: 'low',
    }));
    expect(filtered.marks(0).every((x) => x.type === 'person')).toBe(true);
    expect(filtered.context().boundaryCFI).toBe(boundary);
    const point = filtered.fractionCFI(0.5);
    expect(filtered.position(point).chapter).toBe(2);
    expect(filtered.position(filtered.fractionCFI(1)).chapter).toBe(4);
  } finally {
    repo.close();
  }
});
