import { Type, type Static } from 'typebox';
import type { OpenBook } from './book';
import type { ReviewEntity } from './entity';
import type { PipelineStatus } from './pipeline';
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
}
