// Offline candidate ranking — the compact shortlist goldseam can hand the model
// instead of a deep raw-DOM window. This is the first piece of the
// candidate-ranking architecture in
// .agents/reference/selector-repair-research.md: score selectors offline by how
// well they fit the heal's INTENT (the failing selector + the spec's assertions
// + the aria tree), keep the top-K, and let the model disambiguate from that
// shortlist. It shrinks a ~50K-token deep-page prompt to a few hundred tokens,
// which is what makes a small self-hosted model (Qwen2.5-14B) viable on the
// pages that overflow its context today.
//
// Why this can't just re-use Similo verbatim: Similo fingerprints the target
// element WHEN THE TEST PASSED, then matches it against the changed DOM.
// goldseam captures AFTER the break — the original element is already gone — so
// we score candidates in the post-break capture against the intent we CAN
// reconstruct: the broken selector's shape, the spec's `have.length`/text
// assertions, and the aria roles. The ranking never decides the heal; it orders
// a shortlist (each entry carrying its match count + a text sample) and the
// model, seeing the broken selector's meaning beside those samples, picks. That
// keeps the "never spotlight the renamed element / the model disambiguates"
// invariant: the discriminator is the model reading candidate texts, not us
// substring-matching the broken token (which is at most a light ordering nudge,
// flagged as such).
//
// Sound, not complete: an over-approximate score never REJECTS a heal — a weak
// top score just means the shortlist is thin and the model still has the DOM
// window to fall back on. Like the other offline rungs, it defers rather than
// forces.

import { closeWindow, parseDom } from './dom-env';
import { extractAnchorTexts } from './dom-window';

export interface Candidate {
  /** A CSS selector present in the capture — `.token`, `[data-testid=v]`, `#id`. */
  selector: string;
  /** How many elements it matches in the (untouched) capture. */
  count: number;
  /** Trimmed text of the first match, for the model to disambiguate on. */
  sampleText: string;
  /** 0..1 plausibility for ORDERING the shortlist — not a verdict. */
  score: number;
  /** Human-readable reasons, surfaced in the prompt and diagnostics. */
  why: string[];
}

export interface RankInput {
  failedSelector?: string;
  specSource: string;
  domHtml: string;
  ariaSnapshot?: string;
}

/** The heal's reconstructed intent, mined from the spec + broken selector. */
interface Intent {
  minCount: number | null;
  textPattern: RegExp | null;
  anchorTexts: string[];
  /** Distinctive tokens of the broken selector — a LIGHT ordering nudge only. */
  brokenTokens: string[];
  /** The broken selector keyed off a class/id/attribute culture. */
  culture: 'class' | 'id' | 'attr' | 'other';
}

// Tokens that never make a stable selector — build-artifact hashes and
// utility-CSS. Mirrors the intake scanner's `hashy`/`utility` families so the
// shortlist doesn't fill with `css-1a2b3c` / `px-4`.
const HASHY = /[0-9a-f]{6,}|^(css|sc|jsx|svelte|framer|chakra|mui|tw|emotion|styled)[-_]|--[0-9]|^_/i;
const UTILITY =
  /^(m|p)[trblxy]?-.+$|^(w|h|min-w|min-h|max-w|max-h|gap|space|inset|top|left|right|bottom|z|text|bg|border|rounded|font|leading|tracking|shadow|justify|items|self|place|object|overflow|flex|grid|col|row)-.+$/;
const GENERIC =
  /^(container|wrapper|row|col|column|grid|inner|outer|content|section|block|box|main|layout|flex|item|element|component|active|visible|hidden|open|closed|wide|narrow|left|right|center|clearfix|sr-only|hidden)$/i;

const isMeaningful = (tok: string): boolean =>
  /^[a-z][a-z0-9_-]{2,40}$/i.test(tok) && !HASHY.test(tok) && !UTILITY.test(tok) && /[a-z]{3}/i.test(tok);

// Tags that carry no selectable heal target — a Cypress test never asserts on a
// <style>/<script> body, but Squarespace inlines dozens of them IN the body and
// their CSS/JS text matches loose assertions like /\w+/, so they must not be
// candidates. (`GENERIC` is applied to bare class tokens below, not here.)
const NON_CONTENT = new Set([
  'STYLE', 'SCRIPT', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'PATH', 'META', 'LINK', 'HEAD', 'TITLE', 'BASE',
]);
const isContent = (el: Element): boolean => !NON_CONTENT.has(el.tagName);

/** Parse the spec + broken selector into the intent we score against. */
export function readIntent(input: RankInput): Intent {
  const spec = input.specSource;
  const lenM =
    spec.match(/have\.length(?:\.at\.least|\.greaterThan)?['"\s,)]*?(\d+)/) ??
    spec.match(/\.length\)?\.to\.be\.(?:at\.least|gte|greaterThanOrEqual)\((\d+)\)/);
  const minCount = lenM ? Number(lenM[1]) : null;
  const patM = spec.match(/\.should\(\s*['"]match['"]\s*,\s*\/((?:\\.|[^/])+)\//);
  let textPattern: RegExp | null = null;
  if (patM) {
    try {
      textPattern = new RegExp(patM[1]);
    } catch {
      textPattern = null;
    }
  }
  const sel = input.failedSelector ?? '';
  const brokenTokens = [
    ...sel.matchAll(/\.([\w-]+)|\[[\w-]+[~|^$*]?=["']?([\w-]+)/g),
  ]
    .map((m) => m[1] ?? m[2])
    .filter((t): t is string => Boolean(t) && t.length >= 3);
  const culture: Intent['culture'] = sel.startsWith('.')
    ? 'class'
    : /^\[[\w-]+/.test(sel)
      ? 'attr'
      : sel.startsWith('#')
        ? 'id'
        : 'other';
  return { minCount, textPattern, anchorTexts: extractAnchorTexts(spec), brokenTokens, culture };
}

/** Longest common substring length between two lowercased strings — the LIGHT
 * stem-overlap nudge (kept small so it never dominates: the model, not this,
 * is the discriminator). */
function overlap(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

/** Rank candidate selectors in the capture by fit to the heal intent. Returns
 * the top-K, each with its count + a text sample for the model to choose from.
 * Never throws: a parse failure yields an empty shortlist (the model still has
 * the DOM window). */
export function rankCandidates(input: RankInput, topK = 8): Candidate[] {
  const intent = readIntent(input);
  let window: ReturnType<typeof parseDom>['window'] | undefined;
  try {
    const parsed = parseDom(input.domHtml);
    window = parsed.window;
    const doc = parsed.document;
    const root = doc.body ?? doc;

    // Candidate selectors: meaningful class tokens (match-many lists) and every
    // testid/id/data-* culture value (unique anchors). Deduped.
    const selectors = new Set<string>();
    const classCount = new Map<string, number>();
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (!isContent(el)) continue;
      for (const c of Array.from(el.classList)) {
        if (isMeaningful(c)) classCount.set(c, (classCount.get(c) ?? 0) + 1);
      }
      for (const attr of ['data-testid', 'data-cy', 'data-test', 'id']) {
        const v = el.getAttribute(attr);
        if (v && isMeaningful(v)) {
          selectors.add(attr === 'id' ? `#${v}` : `[${attr}=${v}]`);
        }
      }
    }
    // A class is a candidate if it repeats (a list) OR the broken selector was a
    // single class (rename case) — a renamed class may now be unique-ish too.
    for (const [c, n] of classCount) {
      if (n >= 2 || intent.culture === 'class') selectors.add(`.${c}`);
    }

    const cands: Candidate[] = [];
    for (const selector of selectors) {
      let els: Element[];
      try {
        els = Array.from(root.querySelectorAll(selector)).filter(isContent);
      } catch {
        continue; // not evaluable in this parser — skip
      }
      if (els.length === 0) continue;
      const count = els.length;
      const texts = els.map((e) => (e.textContent ?? '').trim());
      const sampleText = texts.find(Boolean)?.slice(0, 80) ?? '';
      const why: string[] = [];
      let score = 0;

      // count fit vs the spec's expected cardinality (strongest structural signal)
      if (intent.minCount != null) {
        if (count >= intent.minCount && count <= intent.minCount * 6) {
          score += 0.35;
          why.push(`count ${count} fits ">= ${intent.minCount}"`);
        } else if (count >= intent.minCount) {
          score += 0.15;
          why.push(`count ${count} (>= ${intent.minCount} but broad)`);
        }
      } else if (count >= 2) {
        score += 0.1;
      }

      // text consistency: fraction of matches whose text fits the asserted pattern
      const nonEmpty = texts.filter(Boolean);
      if (intent.textPattern && nonEmpty.length) {
        const frac = nonEmpty.filter((t) => intent.textPattern!.test(t)).length / nonEmpty.length;
        score += 0.2 * frac;
        if (frac > 0.6) why.push(`text matches ${intent.textPattern}`);
      }
      if (intent.anchorTexts.length) {
        const hit = intent.anchorTexts.some((a) => texts.some((t) => t.includes(a)));
        if (hit) {
          score += 0.25;
          why.push(`carries asserted text`);
        }
      }

      // homogeneity: a uniform set (same tag) reads as a real list, not a grab-bag
      const tags = new Set(els.map((e) => e.tagName));
      if (count >= 2 && tags.size === 1) {
        score += 0.1;
        why.push(`homogeneous <${[...tags][0].toLowerCase()}>`);
      }

      // culture bonus: prefer the broken selector's own culture, then testid/id
      if (selector.startsWith('[data-') || selector.startsWith('#')) score += 0.08;

      // Name similarity to the broken selector — a legitimate ranking feature
      // (Similo weights `class` too), PROPORTIONAL to how much of the broken
      // token the candidate preserves, so a rename (`summary-title-link` ->
      // `summary-title-link-next`, ~full overlap) outranks a mere family sibling
      // (`summary-item`, partial). It is one signal among count/text/structure,
      // not the only one, so a fully-renamed class with no overlap still ranks
      // on the others. The pick is still the model's, and resolve/rerun verify —
      // so this orders the shortlist, it does not decide the heal.
      const bare = selector.replace(/^[.#]|^\[[\w-]+=|\]$/g, '');
      const stem = Math.max(0, ...intent.brokenTokens.map((t) => overlap(t, bare)));
      const stemFrac = intent.brokenTokens.length
        ? stem / Math.max(...intent.brokenTokens.map((t) => t.length))
        : 0;
      if (stem >= 4) {
        score += 0.3 * stemFrac;
        why.push(`name overlaps the broken selector by ${stem} chars (${Math.round(stemFrac * 100)}%)`);
      }

      cands.push({ selector, count, sampleText, score: Math.min(1, score), why });
    }

    return cands
      .sort((a, b) => b.score - a.score || b.count - a.count)
      .slice(0, topK);
  } catch {
    return [];
  } finally {
    closeWindow(window);
  }
}
