// goldseam trace spine — one sortable timeline of the heal's internal activity.
//
// Adapted from the @pldebug/trace pattern (a single dated converge file,
// timestamp-first so `sort` yields true cross-call ordering; concentric "rings"
// so ring 0 = closest to the issue, widening outward; a correlation id that
// flows through async so every line of one heal shares a tag). goldseam needs
// exactly this to debug the processing: what the ranker scored, how big the
// prompt got, what the model replied, how each rung ruled — and to hunt
// redaction leaks in the bytes that actually reach the model.
//
// OFF BY DEFAULT and free when off — the transparency invariant holds: with
// GOLDSEAM_TRACE unset, every trace() call is a single env check and returns,
// so a heal behaves byte-identically with and without the flag. It writes only
// to a debug file (never the artifacts), builds its payload lazily (never when
// off), and NEVER throws.
//
// Control via env (injected code needs no config):
//   GOLDSEAM_TRACE=1                     enable (off → ~free)
//   GOLDSEAM_TRACE_FILE=/path/trace.log  converge target (default below)
//   GOLDSEAM_TRACE_STDERR=1              also mirror to stderr (default off)
//   GOLDSEAM_TRACE_RING=2                max ring to emit (default 99 = all)

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

const enabled = (): boolean => process.env.GOLDSEAM_TRACE === '1';
const FILE = (): string => process.env.GOLDSEAM_TRACE_FILE ?? '/tmp/goldseam-debug/trace.log';
const TO_STDERR = (): boolean => process.env.GOLDSEAM_TRACE_STDERR === '1';
const MAX_RING = (): number => {
  const n = Number(process.env.GOLDSEAM_TRACE_RING);
  return Number.isFinite(n) ? n : 99;
};

const corrStore = new AsyncLocalStorage<string>();
// Remember the last directory we created, keyed by path — so a runtime change
// of GOLDSEAM_TRACE_FILE (a new converge dir) still gets mkdir'd instead of
// silently ENOENT-ing the append. Cheap: one string compare per line.
let dirReadyFor = '';

type DataFactory = () => Record<string, unknown>;

/**
 * Emit one trace line: `<ISO-ms> <corr> r<ring> <location> <message> <json?>`.
 * `data` is a factory so an expensive payload is never built when tracing is
 * off or the ring is filtered. Never throws — a debug facility must never be
 * able to change a heal's outcome.
 *
 * @param location where it fired, e.g. "prompt:build" or "propose:reply"
 * @param message  short human-readable event
 * @param data     optional lazy structured payload
 * @param ring     0 = closest to the issue; higher = wider field (default 0)
 */
export function trace(location: string, message: string, data?: DataFactory, ring = 0): void {
  if (!enabled() || ring > MAX_RING()) return;
  try {
    const ts = new Date().toISOString();
    const corr = corrStore.getStore() ?? '-';
    let payload = '';
    if (data) {
      try {
        payload = ' ' + JSON.stringify(data());
      } catch {
        payload = ' {"_trace_error":"unserializable"}';
      }
    }
    const line = `${ts} ${corr} r${ring} ${location} ${message}${payload}\n`;
    if (TO_STDERR()) process.stderr.write(line);
    const file = FILE();
    const dir = dirname(file);
    if (dirReadyFor !== dir) {
      mkdirSync(dir, { recursive: true });
      dirReadyFor = dir;
    }
    appendFileSync(file, line);
  } catch {
    /* tracing must never break the run */
  }
}

/** True when tracing is on — guard a genuinely expensive pre-computation the
 * lazy factory can't defer (rare; prefer passing a factory to trace()). */
export function traceEnabled(): boolean {
  return enabled();
}

/** Run `fn` with a correlation id bound to the async context, so every trace
 * line emitted under it shares the tag (one heal = one id). */
export function withCorrelation<T>(id: string, fn: () => T): T {
  return corrStore.run(id, fn);
}

/** A short correlation id without a uuid dep. Deterministic-free (pid+hrtime),
 * used only for log grouping — never for anything a heal's outcome depends on. */
export function newCorrelationId(prefix = 'heal'): string {
  const seed = `${prefix}${process.pid}${process.hrtime.bigint()}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return `${prefix}_${Math.abs(h).toString(36).slice(0, 8)}`;
}
