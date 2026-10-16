import { Type, type Static } from 'typebox';
import type { EntityType } from './entity';
export const SettingsSchema = Type.Object(
  {
    font: Type.Union([Type.Literal('song'), Type.Literal('kai')]),
    fontSize: Type.Integer({ minimum: 16, maximum: 26 }),
    lineHeight: Type.Number({ minimum: 1.5, maximum: 2.3 }),
    theme: Type.Union([
      Type.Literal('day'),
      Type.Literal('night'),
      Type.Literal('system'),
    ]),
    density: Type.Union([
      Type.Literal('low'),
      Type.Literal('medium'),
      Type.Literal('high'),
    ]),
    types: Type.Array(
      Type.Union(
        ['place', 'person', 'people', 'species', 'concept'].map((value) =>
          Type.Literal(value),
        ),
      ),
      { uniqueItems: true, maxItems: 5 },
    ),
    model: Type.String({ maxLength: 120 }),
    focus: Type.Boolean(),
    showOriginalCover: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type Preferences = Omit<Static<typeof SettingsSchema>, 'types'> & {
  types: EntityType[];
};
export const defaultPreferences: Preferences = {
  font: 'song',
  fontSize: 19,
  lineHeight: 1.85,
  theme: 'day',
  density: 'medium',
  types: ['place', 'person', 'people', 'species', 'concept'],
  model: 'deepseek-flash',
  focus: false,
  showOriginalCover: false,
};
export interface LibraryBook {
  id: string;
  title: string;
  author: string;
  boundaryFraction: number;
  currentFraction: number;
}
