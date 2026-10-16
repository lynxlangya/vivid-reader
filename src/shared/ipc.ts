import { Type, type Static } from 'typebox';
import type { OpenBook } from './book';
import type { ReviewEntity } from './entity';
import type { PipelineStatus } from './pipeline';
import type { ReaderState, CardData, Navigation } from './reading';
import type { WikiCandidate } from './entity';
import type { Preferences, LibraryBook } from './settings';
import type { AskRequest, CompanionUpdate, SelectionRange } from './companion';
export const EmptySchema = Type.Object({}, { additionalProperties: false });
export const PingSchema = EmptySchema;
export const PositionSchema = Type.Object(
  { cfi: Type.String({ maxLength: 4096 }) },
  { additionalProperties: false },
);
export const ApiKeySchema = Type.Object(
  { value: Type.String({ minLength: 1, maxLength: 1024 }) },
  { additionalProperties: false },
);
export const ReviewSchema = Type.Object(
  {
    entityId: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    correct: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const RelocateSchema = Type.Object(
  {
    cfi: Type.String({ maxLength: 4096 }),
    mode: Type.Union([
      Type.Literal('next'),
      Type.Literal('prev'),
      Type.Literal('jump'),
    ]),
  },
  { additionalProperties: false },
);
export const IdSchema = Type.Object(
  { id: Type.String({ pattern: '^[a-f0-9]{64}$' }) },
  { additionalProperties: false },
);
export const GlossSchema = Type.Object(
  { id: Type.String({ pattern: '^[a-f0-9]{64}$' }), retry: Type.Boolean() },
  { additionalProperties: false },
);
export const CorrectSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    action: Type.Union([
      Type.Literal('link'),
      Type.Literal('concept'),
      Type.Literal('hide'),
    ]),
    qid: Type.Optional(Type.String({ pattern: '^Q[1-9][0-9]*$' })),
  },
  { additionalProperties: false },
);
export const WikiSearchSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    query: Type.String({ minLength: 1, maxLength: 120 }),
  },
  { additionalProperties: false },
);
export const SelectionSchema = Type.Object(
  {
    start: Type.String({ maxLength: 4096 }),
    end: Type.String({ maxLength: 4096 }),
  },
  { additionalProperties: false },
);
export const AskSchema = Type.Object(
  {
    question: Type.String({ maxLength: 4000 }),
    scope: Type.Optional(
      Type.Union([
        Type.Literal('selection'),
        Type.Literal('chapter'),
        Type.Literal('to_boundary'),
      ]),
    ),
    selection: Type.Optional(SelectionSchema),
  },
  { additionalProperties: false },
);
export type PingRequest = Static<typeof PingSchema>;
export interface VividAPI {
  ping(request: PingRequest): Promise<string>;
  importBook(): Promise<OpenBook | null>;
  restoreBook(): Promise<OpenBook | null>;
  savePosition(cfi: string): Promise<void>;
  setApiKey(value: string): Promise<void>;
  hasApiKey(): Promise<boolean>;
  clearApiKey(): Promise<void>;
  pipelineStatus(): Promise<PipelineStatus>;
  preprocess(): Promise<void>;
  reviewEntities(): Promise<ReviewEntity[]>;
  markReview(entityId: string, correct: boolean): Promise<void>;
  relocate(cfi: string, mode: Navigation): Promise<ReaderState>;
  readerState(): Promise<ReaderState | null>;
  pauseReading(id: string): Promise<void>;
  setBoundary(cfi: string): Promise<ReaderState>;
  card(id: string): Promise<CardData | null>;
  gloss(id: string, retry?: boolean): Promise<CardData | null>;
  markKnown(id: string): Promise<void>;
  correct(
    id: string,
    action: 'link' | 'concept' | 'hide',
    qid?: string,
  ): Promise<void>;
  searchCandidates(id: string, query: string): Promise<WikiCandidate[]>;
  preferences(): Promise<Preferences>;
  savePreferences(value: Preferences): Promise<void>;
  modelCatalog(): Promise<{ id: string; name: string }[]>;
  library(): Promise<LibraryBook[]>;
  openBook(id: string): Promise<OpenBook | null>;
  originalCover(id: string): Promise<string | null>;
  setBoundaryFraction(value: number): Promise<ReaderState>;
  ask(request: AskRequest): Promise<void>;
  conversation(): Promise<CompanionUpdate>;
  selectionAllowed(range: SelectionRange): Promise<boolean>;
  onCompanion(listener: (update: CompanionUpdate) => void): () => void;
  onReaderState(listener: (state: ReaderState) => void): () => void;
}
