import { Type, type Static } from 'typebox';
import type { OpenBook } from './book';
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
export type PingRequest = Static<typeof PingSchema>;
export interface VividAPI {
  ping(request: PingRequest): Promise<string>;
  importBook(): Promise<OpenBook | null>;
  restoreBook(): Promise<OpenBook | null>;
  savePosition(cfi: string): Promise<void>;
  setApiKey(value: string): Promise<void>;
  hasApiKey(): Promise<boolean>;
  clearApiKey(): Promise<void>;
}
