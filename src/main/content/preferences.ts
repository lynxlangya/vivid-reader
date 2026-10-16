import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { Value } from 'typebox/value';
import {
  SettingsSchema,
  defaultPreferences,
  type Preferences,
} from '../../shared/settings';
export class PreferenceStore {
  private value: Preferences;
  constructor(private dir: string) {
    try {
      const value: unknown = JSON.parse(
        readFileSync(join(dir, 'preferences.json'), 'utf8'),
      );
      this.value = Value.Check(SettingsSchema, value)
        ? (value as Preferences)
        : { ...defaultPreferences };
    } catch {
      this.value = { ...defaultPreferences };
    }
  }
  get() {
    return structuredClone(this.value);
  }
  set(value: Preferences) {
    if (!Value.Check(SettingsSchema, value))
      throw new Error('Invalid preferences');
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      join(this.dir, 'preferences.json.tmp'),
      JSON.stringify(value),
      { mode: 0o600 },
    );
    renameSync(
      join(this.dir, 'preferences.json.tmp'),
      join(this.dir, 'preferences.json'),
    );
    this.value = structuredClone(value);
  }
}
