import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Anchor development storage restrictions to the app, never the launch directory.
export function findRepositoryRoot(start: string): string | undefined {
  let dir = resolve(start);
  while (true) {
    const manifest = resolve(dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
        name?: string;
      };
      if (pkg.name === 'vivid-reader')
        return existsSync(resolve(dir, 'AGENTS.md')) &&
          existsSync(resolve(dir, 'src/main'))
          ? realpathSync(dir)
          : undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
const repositoryRoot = findRepositoryRoot(
  dirname(fileURLToPath(import.meta.url)),
);

export function assertOutsideRepository(path: string, message: string) {
  if (!repositoryRoot) return;
  // Resolve existing ancestors too, so a symlink cannot put book data in the repo.
  let ancestor = resolve(path);
  const missing: string[] = [];
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    missing.unshift(relative(parent, ancestor));
    ancestor = parent;
  }
  const target = resolve(realpathSync(ancestor), ...missing);
  const rel = relative(repositoryRoot, target);
  if (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
    throw new Error(message);
}
