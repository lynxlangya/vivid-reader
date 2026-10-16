import { test, expect } from 'vitest';
import { navigationMode } from '../src/renderer/reader/navigation';
test('every relocate during one turn keeps the turn mode, later ones are jumps', async () => {
  const mode = navigationMode();
  const seen: string[] = [];
  expect(mode.current).toBe('jump');
  // Crossing a section emits the old trailing column, then the new section.
  await mode.turn('next', async () => {
    seen.push(mode.current);
    await Promise.resolve();
    seen.push(mode.current);
  });
  seen.push(mode.current);
  expect(seen).toEqual(['next', 'next', 'jump']);
});
test('an earlier turn settling never clears a newer turn or a jump', async () => {
  const mode = navigationMode();
  let finishFirst!: () => void;
  const first = mode.turn(
    'next',
    () => new Promise<void>((r) => (finishFirst = r)),
  );
  let finishSecond!: () => void;
  const second = mode.turn(
    'prev',
    () => new Promise<void>((r) => (finishSecond = r)),
  );
  finishFirst();
  await first;
  expect(mode.current).toBe('prev');
  finishSecond();
  await second;
  expect(mode.current).toBe('jump');
  const third = mode.turn(
    'next',
    () => new Promise<void>((r) => (finishFirst = r)),
  );
  mode.jump();
  expect(mode.current).toBe('jump');
  finishFirst();
  await third;
  expect(mode.current).toBe('jump');
});
test('a failed turn still returns to jump mode', async () => {
  const mode = navigationMode();
  await expect(
    mode.turn('next', () => Promise.reject(new Error('section failed'))),
  ).rejects.toThrow();
  expect(mode.current).toBe('jump');
});
