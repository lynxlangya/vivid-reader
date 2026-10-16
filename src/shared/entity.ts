export type EntityType = 'place' | 'person' | 'people' | 'species' | 'concept';
export interface ExtractedEntity {
  surface: string;
  type: EntityType;
  original_name_guess: string;
  aliases_in_text: string[];
  importance: number;
  note: string;
}
export interface WikiCandidate {
  qid: string;
  label: string;
  original: string;
  description: string;
  lat?: number;
  lon?: number;
  types: string[];
  country?: string;
  image?: string;
  birth?: string;
  death?: string;
}
export interface Entity {
  id: string;
  bookId: string;
  type: EntityType;
  name: string;
  original: string;
  aliases: string[];
  importance: number;
  note: string;
  chapters: number[];
  candidates: WikiCandidate[];
  linked?: WikiCandidate;
  confidence: number;
  status: 'pending' | 'linked' | 'unlinked';
  review: boolean | null;
}
export type ReviewEntity = Omit<Entity, 'note'>;
export interface PipelineReport {
  extracted: number;
  linked: number;
  reviewed: number;
  correct: number;
  linkAccuracy: number | '待人工核对';
  recall: '缺少人工金标准';
  unlinkedRatio: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
  elapsedMs: number;
}
