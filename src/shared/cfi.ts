import * as CFI from '../renderer/vendor/foliate-js/epubcfi.js';
import type { Position, PositionCodec } from './position';
export function validateCFI(value: string): string {
  const bare = value.replace(/\[(?:\^.|[^\]])*\]/g, '');
  // A range part may be empty: foliate writes `,,/1:5` when a page starts at
  // the parent element itself.
  if (
    !/^epubcfi\((?:\/\d+(?::\d+)?)+(?:!(?:\/\d+(?::\d+)?)+)?(?:,(?:\/\d+(?::\d+)?)*){0,2}\)$/.test(
      bare,
    )
  )
    throw new Error('Invalid text CFI');
  const parsed = CFI.parse(value);
  if (!parsed) throw new Error('Invalid text CFI');
  return value;
}
export const positions: PositionCodec = {
  compare: (a, b) => CFI.compare(a.cfi, b.cfi),
  fromString(value) {
    const cfi = validateCFI(value);
    return Object.freeze({ cfi, toString: () => cfi });
  },
  toString: (position: Position) => position.cfi,
};
export const compareCFI = (a: string, b: string) =>
  positions.compare(positions.fromString(a), positions.fromString(b));
