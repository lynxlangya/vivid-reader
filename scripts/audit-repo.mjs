import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const failures = [];
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
for (const path of tracked)
  if (/\.(epub|sqlite3?|db|pmtiles)$/i.test(path))
    failures.push(`Forbidden tracked file: ${path}`);
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'vendor') scan(path);
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const literal of text.matchAll(/(['"`])(?:(?!\1)[\s\S])*?\1/g))
      if ((literal[0].match(/[\u3400-\u9fff]/g) || []).length > 200)
        failures.push(`Long CJK literal: ${path}`);
    if (/console\.log\([^;\n]*(?:apiKey|\bkey\b)/i.test(text))
      failures.push(`Possible key logging: ${path}`);
  }
}
scan('src');
scan('tests');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.info(`Repository audit passed (${tracked.length} tracked files).`);
