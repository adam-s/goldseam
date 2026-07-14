// The debug trace spine. Load-bearing: OFF BY DEFAULT and free when off (the
// transparency invariant — a heal must behave identically with and without the
// flag), it NEVER throws, and it builds its payload lazily so an expensive or
// unserializable factory costs nothing when tracing is off.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newCorrelationId, trace, traceEnabled } from '../src/debug/trace';

let dir: string;
let file: string;
const saved = { on: process.env.GOLDSEAM_TRACE, f: process.env.GOLDSEAM_TRACE_FILE, r: process.env.GOLDSEAM_TRACE_RING };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gs-trace-'));
  file = join(dir, 'sub', 'trace.log'); // sub/ tests the mkdir
  process.env.GOLDSEAM_TRACE_FILE = file;
  delete process.env.GOLDSEAM_TRACE;
  delete process.env.GOLDSEAM_TRACE_RING;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of [['GOLDSEAM_TRACE', saved.on], ['GOLDSEAM_TRACE_FILE', saved.f], ['GOLDSEAM_TRACE_RING', saved.r]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('trace — off by default (transparency)', () => {
  it('writes nothing and never touches disk when GOLDSEAM_TRACE is unset', () => {
    let factoryCalls = 0;
    trace('x:y', 'msg', () => {
      factoryCalls++;
      return { a: 1 };
    });
    expect(existsSync(file)).toBe(false); // no file created
    expect(factoryCalls).toBe(0); // payload never built
    expect(traceEnabled()).toBe(false);
  });
});

describe('trace — on', () => {
  beforeEach(() => (process.env.GOLDSEAM_TRACE = '1'));

  it('appends one timestamp-first line per call, creating the dir', () => {
    trace('prompt:build', 'built', () => ({ chars: 42 }));
    trace('ladder:resolve', 'pass');
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    // <ISO> <corr> r<ring> <location> <message> <json?>
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z - r0 prompt:build built \{"chars":42\}$/);
    expect(lines[1]).toMatch(/ r0 ladder:resolve pass$/);
    expect(traceEnabled()).toBe(true);
  });

  it('respects GOLDSEAM_TRACE_RING (higher rings filtered out, factory not built)', () => {
    process.env.GOLDSEAM_TRACE_RING = '1';
    let built = 0;
    trace('a', 'r0', () => ({ built: ++built }), 0);
    trace('b', 'r2', () => ({ built: ++built }), 2); // filtered
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('r0 a r0');
    expect(built).toBe(1); // the ring-2 factory was never invoked
  });

  it('NEVER throws — an unserializable payload is caught, the line still lands', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => trace('x', 'circ', () => circular)).not.toThrow();
    expect(readFileSync(file, 'utf8')).toContain('{"_trace_error":"unserializable"}');
  });

  it('binds a correlation id to trace lines', async () => {
    const { withCorrelation } = await import('../src/debug/trace');
    const id = newCorrelationId('heal');
    expect(id).toMatch(/^heal_[a-z0-9]{1,8}$/);
    withCorrelation(id, () => trace('x', 'in-context'));
    trace('x', 'out-of-context');
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines[0]).toContain(` ${id} r0 `);
    expect(lines[1]).toContain(' - r0 '); // '-' when no correlation id
  });
});
