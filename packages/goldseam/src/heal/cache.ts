// Heal memory — the cache tier. A verified model heal records
// (broken selector → replacement selector); the next capture with the
// same broken selector proposes the cached replacement with NO model
// call. Unlike the incumbent's cache tier, a cache proposal still runs
// the full verification ladder — cache skips cost, never scrutiny.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { RepairEdit } from './types';

export interface CacheEntry {
  failedSelector: string;
  replacement: string;
  /** Provenance for humans reading the artifact/PR. */
  healedAt: string;
  specPath: string;
}

export function loadCache(file: string): CacheEntry[] {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? (parsed as CacheEntry[]) : [];
  } catch {
    return []; // a corrupt cache must never break healing
  }
}

export function saveEntry(file: string, entry: CacheEntry): void {
  const cache = loadCache(file).filter((e) => e.failedSelector !== entry.failedSelector);
  cache.push(entry);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2));
  renameSync(tmp, file);
}

export const lookup = (cache: CacheEntry[], failedSelector: string): CacheEntry | undefined =>
  cache.find((e) => e.failedSelector === failedSelector);

/**
 * Derive the replacement selector from a verified edit: the edit's changed
 * core must be a substring change *within* the broken selector, otherwise
 * the heal isn't cacheable (returns undefined).
 */
export function deriveReplacement(edit: RepairEdit, failedSelector: string): string | undefined {
  let p = 0;
  const { oldString, newString } = edit;
  while (p < oldString.length && p < newString.length && oldString[p] === newString[p]) p++;
  let s = 0;
  while (
    s < oldString.length - p &&
    s < newString.length - p &&
    oldString[oldString.length - 1 - s] === newString[newString.length - 1 - s]
  ) s++;
  const oldCore = oldString.slice(p, oldString.length - s);
  const newCore = newString.slice(p, newString.length - s);
  if (!oldCore || !failedSelector.includes(oldCore)) return undefined;
  return failedSelector.replace(oldCore, () => newCore);
}

/**
 * Turn a cache entry into a concrete edit for THIS spec: the broken
 * selector must appear exactly once. Anything else is a miss, not an error.
 */
export function buildCacheEdit(
  entry: CacheEntry,
  specPath: string,
  specSource: string,
): RepairEdit | undefined {
  const occurrences = specSource.split(entry.failedSelector).length - 1;
  if (occurrences !== 1) return undefined;
  return {
    file: specPath,
    oldString: entry.failedSelector,
    newString: entry.replacement,
  };
}
