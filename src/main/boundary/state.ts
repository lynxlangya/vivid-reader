import { compareCFI } from '../../shared/cfi';
import { collapse } from '../../renderer/vendor/foliate-js/epubcfi.js';
import type { Navigation } from '../../shared/reading';
export const DWELL_MS = 5000;
export interface BoundaryState {
  currentCFI: string;
  boundaryCFI: string;
  pending?: { page: string; end: string; since: number };
}
export type BoundaryEvent =
  | { type: 'relocate'; cfi: string; mode: Navigation; now: number }
  | { type: 'dwell'; now: number }
  | { type: 'pause' }
  | { type: 'manual'; cfi: string };
export function advanceBoundary(
  state: BoundaryState,
  event: BoundaryEvent,
): { state: BoundaryState; archive: boolean } {
  if (event.type === 'pause')
    return {
      state: { currentCFI: state.currentCFI, boundaryCFI: state.boundaryCFI },
      archive: false,
    };
  if (event.type === 'manual') {
    const boundaryCFI = collapse(event.cfi, true);
    return {
      state: { currentCFI: state.currentCFI, boundaryCFI },
      archive: compareCFI(boundaryCFI, state.boundaryCFI) < 0,
    };
  }
  if (event.type === 'dwell') {
    const pending = state.pending;
    if (
      !pending ||
      pending.page !== state.currentCFI ||
      event.now - pending.since < DWELL_MS
    )
      return { state, archive: false };
    return {
      state: {
        currentCFI: state.currentCFI,
        boundaryCFI:
          compareCFI(pending.end, state.boundaryCFI) > 0
            ? pending.end
            : state.boundaryCFI,
      },
      archive: false,
    };
  }
  const sequential =
    event.mode === 'next' &&
    compareCFI(collapse(state.currentCFI, false), state.boundaryCFI) <= 0;
  return {
    state: {
      currentCFI: event.cfi,
      boundaryCFI: state.boundaryCFI,
      ...(sequential
        ? {
            pending: {
              page: event.cfi,
              end: collapse(event.cfi, true),
              since: event.now,
            },
          }
        : {}),
    },
    archive: false,
  };
}
