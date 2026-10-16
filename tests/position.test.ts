import { test, expect } from 'vitest';
import { positions, compareCFI } from '../src/shared/cfi';
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
