// scoreSelector — a portable selector-optimality grader for goldseam.
//
// "Resolves on the page" is a correctness gate; it says nothing about whether a
// selector will SURVIVE the next render. This module scores a CSS/Cypress-jQuery
// selector string on the same axis the recorders do: how positional/volatile is
// the identity it leans on?
//
// The cost model is lifted from Playwright's selectorGenerator (kTestIdScore=1 …
// kNthScore=10000 … kCSSFallbackScore=1e7) — Copyright (c) Microsoft Corporation,
// Apache-2.0 (github.com/microsoft/playwright, packages/playwright-core/src/server/
// injected/selectorGenerator.ts; `isGuidLike` and the score constants are
// verbatim). Brittleness is decided by the WORST rung in the compound selector —
// a chain that anchors on `#id` but ends in `:nth-of-type(2)` is exactly as
// brittle as the nth it contains. The headline `tier` reports the BEST identity
// signal present (unless the selector is brittle, in which case the tier names
// the brittle reason).

// ── cost model (verbatim constants, Playwright selectorGenerator) ───────────
const kTestIdScore = 1;
const kOtherTestIdScore = 2;
// kRoleWithNameScore retained for parity with the source's rung table; the
// grader has no role-with-name piece to assign it to (selectors, not locators).
const kLabelScore = 140; // stands in for semantic attr-equals (name/href/aria-label/…)
const kAltTextScore = 160;
const kTextScore = 180;
const kCSSIdScore = 500;
const kRoleWithoutNameScore = 510;
const kCSSInputTypeNameScore = 520;
const kCSSTagNameScore = 530;
const kNthScore = 10000;
const kCSSFallbackScore = 10000000;

// ── stable/volatile data-* filter ──────────────────────────────────────────
const TESTID_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'];
// Semantic attribute-equals hooks that are IDENTITY, not position.
const STABLE_ATTRS = ['name', 'placeholder', 'aria-label', 'alt', 'title', 'href', 'for', 'role', 'type'];
const VOLATILE_DATA_ATTR =
  /^data-(cairn-|reactid|react-|server-rendered|state|turbo|hydrate|n-head|v-|svelte|emotion|styled|remove|reactroot)/;
// Attributes whose VALUE is a JS handler / runtime string, not a stable identity.
const JS_HANDLER_ATTRS = new Set(['onclick', 'onchange', 'oninput', 'onsubmit', 'style', 'value']);

/** Score + classification of one simple-selector piece. */
export type SelectorTier =
  | 'testid'
  | 'stable-data'
  | 'role'
  | 'attr-stable'
  | 'text'
  | 'id'
  | 'attr-weak'
  | 'tag'
  | 'nth'
  | 'guid-id'
  | 'volatile-data'
  | 'js-attr'
  | 'unknown';

interface PieceScore {
  score: number;
  tier: SelectorTier;
  brittle: boolean;
  reason?: string;
}

// ── isGuidLike (verbatim, Playwright selectorGenerator) ─────────────────────
export function isGuidLike(id: string): boolean {
  let lastCharacterType: 'lower' | 'upper' | 'digit' | 'other' | undefined;
  let transitionCount = 0;
  for (let i = 0; i < id.length; ++i) {
    const c = id[i];
    let characterType: 'lower' | 'upper' | 'digit' | 'other';
    if (c === '-' || c === '_') continue;
    if (c >= 'a' && c <= 'z') characterType = 'lower';
    else if (c >= 'A' && c <= 'Z') characterType = 'upper';
    else if (c >= '0' && c <= '9') characterType = 'digit';
    else characterType = 'other';
    if (characterType === 'lower' && lastCharacterType === 'upper') {
      lastCharacterType = characterType;
      continue;
    }
    if (lastCharacterType && lastCharacterType !== characterType) ++transitionCount;
    lastCharacterType = characterType;
  }
  return transitionCount >= id.length / 4;
}

// Framework-generated sequential/auto ids — the SAME churn hazard as a guid, but
// low-transition (word + trailing counter), so isGuidLike misses them.
// ExtJS `ext-gen1234`, GWT `gwt-uid-3`, YUI `yui_3_10`, Ember `ember123`, MUI
// `mui-42`, Radix `radix-:r0:` / `:r3:`, HeadlessUI `headlessui-…`, Angular CDK
// `cdk-overlay-7` / `mat-input-2`. These re-number every render — never a heal target.
const FRAMEWORK_AUTO_ID =
  /^(ext-gen|ext-comp|ext-element|gwt-uid|yui[_-]|ember\d|mui-|radix-|:r[0-9a-z]+:|headlessui-|cdk-|mat-\w+-\d|aria-|downshift-|react-select-|rc_select_|:R[0-9a-z]+:)/i;

// An id we must not lean on: guid OR a framework auto-id OR a pure counter.
export function isVolatileId(id: string): boolean {
  if (isGuidLike(id)) return true;
  if (FRAMEWORK_AUTO_ID.test(id)) return true;
  if (/^[a-z]{1,4}[-_]?\d{3,}$/i.test(id)) return true; // short-prefix + long counter (uid_10423)
  return false;
}

// A `data-*` hook that is a human-authored stable identifier.
function isStableDataHook(name: string, value: string | undefined): boolean {
  if (!name.startsWith('data-')) return false;
  if (TESTID_ATTRS.includes(name)) return false;
  if (value !== undefined && (value === '' || value.length > 64)) return false;
  if (VOLATILE_DATA_ATTR.test(name)) return false;
  return value === undefined || !isGuidLike(value);
}

// ── tokenizer ───────────────────────────────────────────────────────────────
// Split a compound selector into simple selectors on descendant/child/sibling
// combinators, then pull the pieces out of each. Deliberately lightweight — a
// full CSS parser is unwarranted; the shapes models emit are shallow.
const NTH_PSEUDOS =
  /^(nth-of-type|nth-last-of-type|nth-child|nth-last-child|first-of-type|last-of-type|first-child|last-child|eq|first|last)\b/;

type Piece =
  | { kind: 'id'; value: string }
  | { kind: 'attr'; name: string; value: string | undefined }
  | { kind: 'pseudo'; name: string; arg: string | undefined }
  | { kind: 'class'; value: string }
  | { kind: 'tag'; value: string };

function tokenizePiece(part: string): Piece[] {
  const pieces: Piece[] = [];
  // ids: #foo   (not [id="..."], handled as attr below)
  for (const m of part.matchAll(/#([\w\-]+)/g)) pieces.push({ kind: 'id', value: m[1] });
  // attributes: [name="v"] / [name='v'] / [name=v] / [name]
  for (const m of part.matchAll(/\[\s*([\w\-:]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]]*?)))?\s*\]/g)) {
    const name = m[1];
    const value = m[3] ?? m[4] ?? m[5];
    pieces.push({ kind: 'attr', name, value: value === undefined ? undefined : value.trim() });
  }
  // pseudos / pseudo-classes: :nth-of-type(2), :contains('x'), :hover, ::part
  for (const m of part.matchAll(/::?([\w\-]+)(\([^)]*\))?/g)) {
    pieces.push({ kind: 'pseudo', name: m[1], arg: m[2] });
  }
  // classes
  for (const m of part.matchAll(/\.([\w\-]+)/g)) pieces.push({ kind: 'class', value: m[1] });
  // leading tag name
  const tag = part.match(/^([a-zA-Z][\w-]*)/);
  if (tag) pieces.push({ kind: 'tag', value: tag[1] });
  return pieces;
}

// Score + classify one piece.
function scorePiece(p: Piece): PieceScore {
  if (p.kind === 'id') {
    if (isVolatileId(p.value))
      return { score: kCSSFallbackScore, tier: 'guid-id', brittle: true, reason: `volatile/auto-generated id #${p.value}` };
    return { score: kCSSIdScore, tier: 'id', brittle: false };
  }
  if (p.kind === 'attr') {
    const n = p.name.toLowerCase();
    if (TESTID_ATTRS.includes(n)) return { score: kTestIdScore, tier: 'testid', brittle: false };
    if (n.startsWith('data-')) {
      if (isStableDataHook(n, p.value)) return { score: kOtherTestIdScore, tier: 'stable-data', brittle: false };
      return { score: kCSSFallbackScore, tier: 'volatile-data', brittle: true, reason: `volatile data-* [${n}]` };
    }
    if (JS_HANDLER_ATTRS.has(n)) return { score: kNthScore, tier: 'js-attr', brittle: true, reason: `runtime/handler attr [${n}]` };
    if (n === 'type') return { score: kCSSInputTypeNameScore, tier: 'attr-weak', brittle: false, reason: 'type= shared by many elements' };
    if (n === 'part') return { score: kAltTextScore, tier: 'attr-stable', brittle: false }; // shadow ::part contract
    if (STABLE_ATTRS.includes(n) || n.startsWith('aria-')) return { score: kLabelScore, tier: 'attr-stable', brittle: false };
    // unknown attribute — treat as weak css
    return { score: kCSSTagNameScore, tier: 'attr-weak', brittle: false };
  }
  if (p.kind === 'pseudo') {
    if (NTH_PSEUDOS.test(p.name))
      return { score: kNthScore, tier: 'nth', brittle: true, reason: `positional pseudo :${p.name}${p.arg ?? ''}` };
    if (p.name === 'contains') return { score: kTextScore, tier: 'text', brittle: false };
    if (p.name === 'part') return { score: kAltTextScore, tier: 'attr-stable', brittle: false };
    // structural/state pseudos (:hover,:not,:visible…) — neutral, no identity
    return { score: kRoleWithoutNameScore, tier: 'attr-weak', brittle: false };
  }
  if (p.kind === 'class') return { score: kCSSTagNameScore, tier: 'attr-weak', brittle: false, reason: 'class-based (churns with styling)' };
  if (p.kind === 'tag') return { score: kCSSTagNameScore, tier: 'tag', brittle: false };
  return { score: kCSSFallbackScore, tier: 'unknown', brittle: true, reason: 'unparsed' };
}

// Ascending identity-quality rank for the headline tier (best signal wins).
const TIER_RANK: SelectorTier[] = ['testid', 'stable-data', 'role', 'attr-stable', 'text', 'id', 'attr-weak', 'tag'];
const OPTIMAL_TIERS = new Set<SelectorTier>(['testid', 'stable-data', 'id', 'role']);

export interface SelectorScore {
  /** worst-rung cost (higher = more positional/volatile). */
  cost: number;
  /** best identity signal present, or the brittle reason class. */
  tier: SelectorTier;
  /** any rung is positional (nth), guid-id, volatile data-*, or a JS-handler attr. */
  brittle: boolean;
  /** human-readable notes for a reviewFlag / gate message. */
  reasons: string[];
}

/**
 * scoreSelector(selector) → { cost, tier, brittle, reasons[] }
 */
export function scoreSelector(selector: string): SelectorScore {
  const reasons: string[] = [];
  const combinators = /\s*[>+~]\s*|\s+/;
  const parts = String(selector).trim().split(combinators).filter(Boolean);
  const scored: PieceScore[] = [];
  for (const part of parts) for (const piece of tokenizePiece(part)) scored.push(scorePiece(piece));
  if (scored.length === 0) return { cost: kCSSFallbackScore, tier: 'unknown', brittle: true, reasons: ['empty/unparsed selector'] };

  const brittle = scored.some((s) => s.brittle);
  for (const s of scored) if (s.reason) reasons.push(s.reason);
  const cost = Math.max(...scored.map((s) => s.score));

  let tier: SelectorTier;
  if (brittle) {
    // Name the brittle class (prefer the highest-cost brittle rung).
    tier = scored.filter((s) => s.brittle).sort((a, b) => b.score - a.score)[0].tier;
  } else {
    const present = new Set(scored.map((s) => s.tier));
    tier = TIER_RANK.find((t) => present.has(t)) ?? scored.slice().sort((a, b) => a.score - b.score)[0].tier;
  }
  return { cost, tier, brittle, reasons };
}

export function isOptimal(selector: string): boolean {
  const r = scoreSelector(selector);
  return !r.brittle && OPTIMAL_TIERS.has(r.tier);
}

export { OPTIMAL_TIERS };
