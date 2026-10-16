import { Type, type Static } from 'typebox';
export const PingSchema = Type.Object({}, { additionalProperties: false });
export type PingRequest = Static<typeof PingSchema>;
export interface VividAPI {
  ping(request: PingRequest): Promise<string>;
}
