import { test, expect } from 'vitest';
import { positions, compareCFI } from '../src/shared/cfi';
import { collapse } from '../src/renderer/vendor/foliate-js/epubcfi.js';
test('compares chapter, node, and character order using Foliate', () => {
  expect(
    compareCFI('epubcfi(/6/2!/4/2/1:0)', 'epubcfi(/6/2!/4/4/1:0)'),
  ).toBeLessThan(0);
  expect(
    compareCFI('epubcfi(/6/2!/4/2/1:2)', 'epubcfi(/6/4!/4/2/1:0)'),
  ).toBeLessThan(0);
  expect(
    compareCFI('epubcfi(/6/2!/4/2/1:2)', 'epubcfi(/6/2!/4/2/1:3)'),
  ).toBeLessThan(0);
  const value = 'epubcfi(/6/2!/4/2/1:2)';
  expect(positions.fromString(value).toString()).toBe(value);
  expect(compareCFI(value, value)).toBe(0);
});
test('accepts a range whose start is the parent element itself', () => {
  const page = 'epubcfi(/6/4!/4/68,,/1:55)';
  expect(positions.fromString(page).toString()).toBe(page);
  expect(collapse(page)).toBe('epubcfi(/6/4!/4/68)');
  expect(compareCFI(page, 'epubcfi(/6/4!/4/68/1:0)')).toBeLessThan(0);
  expect(compareCFI(collapse(page, true), 'epubcfi(/6/4!/4/68/1:55)')).toBe(0);
});
test.each([
  '',
  'not-a-cfi',
  'epubcfi()',
  'epubcfi(/x/2)',
  'epubcfi(/6/-2)',
  'epubcfi(/6/2!:3)',
  'epubcfi(/6/2)junk',
])('rejects invalid position %s', (value) => {
  expect(() => positions.fromString(value)).toThrow();
});
