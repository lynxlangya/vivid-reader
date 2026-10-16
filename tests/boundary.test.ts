import { test, expect } from 'vitest';
import {
  advanceBoundary,
  DWELL_MS,
  type BoundaryState,
} from '../src/main/boundary/state';
const cfi = (chapter: number, offset: number) =>
  `epubcfi(/6/${(chapter + 1) * 2}!/4/2/1:${offset})`;
const state: BoundaryState = { currentCFI: cfi(0, 0), boundaryCFI: cfi(0, 10) };
test('sequential reading waits five seconds and only advances', () => {
  const next = advanceBoundary(state, {
    type: 'relocate',
    mode: 'next',
    adjacent: true,
    cfi: cfi(0, 20),
    now: 100,
  }).state;
  expect(
    advanceBoundary(next, { type: 'dwell', now: 100 + DWELL_MS - 1 }).state
      .boundaryCFI,
  ).toBe(cfi(0, 10));
  expect(
    advanceBoundary(next, { type: 'dwell', now: 100 + DWELL_MS }).state
      .boundaryCFI,
  ).toBe(cfi(0, 20));
  const reread = advanceBoundary(
    { ...state, boundaryCFI: cfi(1, 50) },
    {
      type: 'relocate',
      mode: 'next',
      adjacent: true,
      cfi: cfi(0, 20),
      now: 0,
    },
  ).state;
  expect(
    advanceBoundary(reread, { type: 'dwell', now: DWELL_MS }).state.boundaryCFI,
  ).toBe(cfi(1, 50));
});
test('jump and subsequent next beyond the boundary never advance it', () => {
  const jump = advanceBoundary(state, {
    type: 'relocate',
    mode: 'jump',
    adjacent: false,
    cfi: cfi(3, 20),
    now: 0,
  }).state;
  expect(
    advanceBoundary(jump, { type: 'dwell', now: 99999 }).state.boundaryCFI,
  ).toBe(state.boundaryCFI);
  const next = advanceBoundary(jump, {
    type: 'relocate',
    mode: 'next',
    adjacent: true,
    cfi: cfi(3, 40),
    now: 10,
  }).state;
  expect(
    advanceBoundary(next, { type: 'dwell', now: 99999 }).state.boundaryCFI,
  ).toBe(state.boundaryCFI);
});
test('prev cancels pending dwell; manual movement archives only when rewinding', () => {
  const pending = advanceBoundary(state, {
    type: 'relocate',
    mode: 'next',
    adjacent: true,
    cfi: cfi(0, 20),
    now: 0,
  }).state;
  const prev = advanceBoundary(pending, {
    type: 'relocate',
    mode: 'prev',
    adjacent: false,
    cfi: cfi(0, 0),
    now: 100,
  }).state;
  expect(
    advanceBoundary(prev, { type: 'dwell', now: 99999 }).state.boundaryCFI,
  ).toBe(state.boundaryCFI);
  expect(
    advanceBoundary(state, { type: 'manual', cfi: cfi(2, 20) }).archive,
  ).toBe(false);
  const rewind = advanceBoundary(state, { type: 'manual', cfi: cfi(0, 5) });
  expect(rewind.archive).toBe(true);
  expect(rewind.state.pending).toBeUndefined();
});

test('leaving the reader cancels pending dwell without losing the current location', () => {
  const next = advanceBoundary(state, {
    type: 'relocate',
    mode: 'next',
    adjacent: true,
    cfi: cfi(0, 20),
    now: 0,
  }).state;
  const paused = advanceBoundary(next, { type: 'pause' }).state;
  expect(paused.currentCFI).toBe(next.currentCFI);
  expect(paused.pending).toBeUndefined();
  expect(
    advanceBoundary(paused, { type: 'dwell', now: DWELL_MS * 2 }).state
      .boundaryCFI,
  ).toBe(state.boundaryCFI);
});
test('a next that skips text is treated as a jump and never advances', () => {
  // A stale "next" hint can arrive with a link jump far ahead of the boundary.
  const skipped = advanceBoundary(state, {
    type: 'relocate',
    mode: 'next',
    adjacent: false,
    cfi: cfi(3, 20),
    now: 0,
  }).state;
  expect(skipped.pending).toBeUndefined();
  expect(
    advanceBoundary(skipped, { type: 'dwell', now: 99999 }).state.boundaryCFI,
  ).toBe(state.boundaryCFI);
  const after = advanceBoundary(skipped, {
    type: 'relocate',
    mode: 'next',
    adjacent: true,
    cfi: cfi(3, 40),
    now: 10,
  }).state;
  expect(
    advanceBoundary(after, { type: 'dwell', now: 99999 }).state.boundaryCFI,
  ).toBe(state.boundaryCFI);
});
