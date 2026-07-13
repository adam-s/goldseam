// Pins the selector-optimality grader (src/heal/selector-score.ts): the tier a
// selector lands in and, more importantly, whether it is flagged BRITTLE. The
// brittle bit drives the heal-path reviewFlag, so a regression here would either
// nag on stable selectors or stay silent on positional/volatile ones.

import { describe, expect, it } from 'vitest';
import { isGuidLike, isOptimal, isVolatileId, scoreSelector } from '../src/heal/selector-score';

describe('scoreSelector — tiers and brittleness', () => {
  it('data-testid is optimal (best tier, not brittle)', () => {
    const r = scoreSelector('[data-testid="add-to-cart"]');
    expect(r.tier).toBe('testid');
    expect(r.brittle).toBe(false);
    expect(isOptimal('[data-testid="add-to-cart"]')).toBe(true);
  });

  it('a human-authored id is optimal', () => {
    const r = scoreSelector('#login-button');
    expect(r.tier).toBe('id');
    expect(r.brittle).toBe(false);
    expect(isOptimal('#login-button')).toBe(true);
  });

  it('a framework auto-id (#ext-gen123) is brittle', () => {
    const r = scoreSelector('#ext-gen123');
    expect(r.brittle).toBe(true);
    expect(r.tier).toBe('guid-id');
    expect(r.reasons.join(' ')).toMatch(/auto-generated id/);
    expect(isOptimal('#ext-gen123')).toBe(false);
  });

  it('a guid-like id is brittle', () => {
    const r = scoreSelector('#a1b2C3d4-e5f6');
    expect(r.brittle).toBe(true);
    expect(r.tier).toBe('guid-id');
    expect(isOptimal('#a1b2C3d4-e5f6')).toBe(false);
  });

  it('a positional :nth-of-type is brittle', () => {
    const r = scoreSelector('input:nth-of-type(2)');
    expect(r.brittle).toBe(true);
    expect(r.tier).toBe('nth');
    expect(r.reasons.join(' ')).toMatch(/positional pseudo/);
    expect(isOptimal('input:nth-of-type(2)')).toBe(false);
  });

  it('a JS-handler attribute is brittle', () => {
    const r = scoreSelector("button[onclick='x()']");
    expect(r.brittle).toBe(true);
    expect(r.tier).toBe('js-attr');
    expect(r.reasons.join(' ')).toMatch(/runtime\/handler attr/);
    expect(isOptimal("button[onclick='x()']")).toBe(false);
  });

  it('a volatile data-* attribute is brittle', () => {
    const r = scoreSelector('[data-reactid="3"]');
    expect(r.brittle).toBe(true);
    expect(r.tier).toBe('volatile-data');
    expect(r.reasons.join(' ')).toMatch(/volatile data-\*/);
  });

  it('a class-based selector is NOT brittle but is non-optimal (flagged for authoring)', () => {
    const r = scoreSelector('.action-email');
    expect(r.brittle).toBe(false);
    expect(r.tier).toBe('attr-weak');
    expect(isOptimal('.action-email')).toBe(false);
  });

  it('the WORST rung decides brittleness — a stable id ending in :nth is brittle', () => {
    const r = scoreSelector('#form > input:nth-child(3)');
    expect(r.brittle).toBe(true);
    expect(r.tier).toBe('nth'); // brittle rung names the tier, not the #id
    expect(r.cost).toBe(10000); // kNthScore is the worst rung
  });

  it('a stable data-hook (non-testid) is optimal', () => {
    const r = scoreSelector('[data-component="cart"]');
    expect(r.tier).toBe('stable-data');
    expect(r.brittle).toBe(false);
    expect(isOptimal('[data-component="cart"]')).toBe(true);
  });

  it('an empty/unparsed selector is brittle-unknown, never optimal', () => {
    const r = scoreSelector('   ');
    expect(r.brittle).toBe(true);
    expect(r.tier).toBe('unknown');
    expect(isOptimal('   ')).toBe(false);
  });
});

describe('helpers', () => {
  it('isGuidLike catches hyphenated hex, misses a plain word', () => {
    expect(isGuidLike('a1b2C3d4-e5f6')).toBe(true);
    expect(isGuidLike('login-button')).toBe(false);
  });

  it('isVolatileId catches framework auto-ids and long counters', () => {
    expect(isVolatileId('ext-gen123')).toBe(true);
    expect(isVolatileId('mui-42')).toBe(true);
    expect(isVolatileId('uid_10423')).toBe(true);
    expect(isVolatileId('login-button')).toBe(false);
  });
});
