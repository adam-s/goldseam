import { mkdirSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';

/** Write pretty JSON atomically (tmp file + rename), creating parent dirs.
 * The rename is atomic on a POSIX filesystem, so parallel Cypress workers
 * never observe a torn artifact — the reason capture/oracle/prompt files can
 * be written from concurrent runs. */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, filePath);
}
