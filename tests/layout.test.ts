import { test, expect } from 'vitest';
import { cardLayout } from '../src/renderer/glimpse/layout';
test('margin and fallback keep current line clear even near either edge', () => {
  const col = { left: 100, right: 780, top: 88, bottom: 828 };
  expect(
    cardLayout(
      { left: 200, right: 240, top: 250, bottom: 280 },
      col,
      1280,
      900,
      520,
    ),
  ).toMatchObject({ side: true, left: 820, top: 250 });
  for (const top of [90, 250, 700, 820]) {
    const line = { left: 200, right: 240, top, bottom: top + 35 };
    const layout = cardLayout(line, col, 1080, 900, 600);
    const height = Math.min(600, layout.maxHeight);
    expect(layout.side).toBe(false);
    expect(layout.top >= line.bottom || layout.top + height <= line.top).toBe(
      true,
    );
  }
});
