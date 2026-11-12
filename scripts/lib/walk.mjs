import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Recursively list files under `dir`, returning paths for which `keep(path)` is true. */
export function listFiles(dir, keep = () => true) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(path, keep);
    return entry.isFile() && keep(path) ? [path] : [];
  });
}
