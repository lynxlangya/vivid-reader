export interface TextRun {
  start: number;
  end: number;
  cfi: string;
}
export interface Chapter {
  id: string;
  index: number;
  href: string;
  title: string;
  baseCFI: string;
  bodyPath: string;
  text: string;
  runs: TextRun[];
  blocks?: number[];
}
export type { ReaderMark as ProbeMark } from './reading';
export interface OpenBook {
  id: string;
  title: string;
  author: string;
  url: string;
  currentCFI?: string;
  fresh: boolean;
  marks: import('./reading').ReaderMark[];
}
