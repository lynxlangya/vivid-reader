// Runs work over items with at most `size` in flight. After a failure no new
// item starts; the first error is rethrown once the running ones settle.
export async function eachLimit<T>(
  items: readonly T[],
  size: number,
  run: (item: T, index: number) => Promise<void>,
) {
  let next = 0;
  let failure: { error: unknown } | undefined;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (!failure && next < items.length) {
        const index = next++;
        try {
          await run(items[index], index);
        } catch (error) {
          failure ??= { error };
        }
      }
    }),
  );
  if (failure) throw failure.error;
}
