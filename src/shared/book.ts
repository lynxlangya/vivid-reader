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
}
export interface ProbeMark {
  name: string;
  type: 'place' | 'person';
  chapter: number;
  startCFI: string;
  endCFI: string;
}
export interface OpenBook {
  id: string;
  title: string;
  author: string;
  bytes: Uint8Array;
  currentCFI?: string;
  marks: ProbeMark[];
}
