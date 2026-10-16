export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export function cardLayout(
  line: Box,
  column: Box,
  width: number,
  height: number,
  cardHeight: number,
) {
  const margin = width - column.right;
  const side = margin >= 400;
  const available = Math.max(line.top - 24, height - line.bottom - 40);
  const maxHeight = side ? height - 96 : Math.min(height - 96, available);
  const h = Math.min(cardHeight, maxHeight);
  const top = side
    ? Math.max(16, Math.min(line.top, height - h - 28))
    : height - line.bottom - 40 >= h
      ? line.bottom + 12
      : Math.max(16, line.top - h - 12);
  const left = side
    ? column.right + 40
    : Math.max(16, Math.min(line.left, width - 376));
  return { side, top, left, maxHeight };
}
