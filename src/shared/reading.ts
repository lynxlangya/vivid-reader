import type { EntityType, WikiCandidate } from './entity';
export type Navigation = 'next' | 'prev' | 'jump';
export interface Mention {
  id: string;
  entityId: string;
  chapterId: string;
  chapter: number;
  start: number;
  end: number;
  surface: string;
  cfiRange: string;
  startCFI: string;
  endCFI: string;
}
export interface ReaderMark {
  id: string;
  entityId: string;
  name: string;
  type: EntityType;
  chapter: number;
  startCFI: string;
  endCFI: string;
  seenBefore: boolean;
  importance: number;
}
export interface ReaderState {
  currentCFI: string;
  boundaryCFI: string;
  currentChapter: number;
  boundaryChapter: number;
  currentFraction: number;
  boundaryFraction: number;
  beyond: boolean;
  marks: ReaderMark[];
  toc: { chapter: number; title: string; percent?: number }[];
}
export interface MapReference {
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
}
export interface CardData {
  id: string;
  name: string;
  original: string;
  type: EntityType;
  fact?: WikiCandidate;
  footprint: { firstChapter: number; count: number };
  references: MapReference[];
  plate: string;
  gloss: { status: 'ready' | 'loading' | 'failed' | 'unread'; text?: string };
  candidates: WikiCandidate[];
}
export interface TextSlice {
  text: string;
  startCFI?: string;
  endCFI?: string;
  chapter?: number;
}
