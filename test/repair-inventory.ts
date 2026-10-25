import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Inventory every tracker byte and relative name, including journals and caches. */
export async function inventory(root: string): Promise<string> {
  const hash = createHash('sha256');
  for (const entry of (await readdir(root, { recursive: true, withFileTypes: true })).filter(row => row.isFile()).sort((a, b) => join(a.parentPath, a.name).localeCompare(join(b.parentPath, b.name)))) {
    hash.update(join(entry.parentPath, entry.name).slice(root.length));
    hash.update(await readFile(join(entry.parentPath, entry.name)));
  }
  return hash.digest('hex');
}
