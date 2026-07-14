// The repair prompt. This file and the RepairReply type are the same doc
// family as the artifact schema — the prompt contract is a public API.
//
// Invariant enforced here: the model sees the capture (runtime snapshots)
// and the spec source. Never application source.

import { FailureArtifact } from '../shared/types';
import { trace } from '../debug/trace';
import { deboilerplateDom, windowDom } from './dom-window';
import { Candidate, rankCandidates } from './rank';

// The prompt's DOM-slimming (style/script strip + anchored neighborhood
// window) lives in dom-window.ts; re-exported here because it is part of the
// prompt contract. See that file for the content-neutral / prompt-only
// invariants and the evidence behind the windowing gate.
export { deboilerplateDom };

const MAX_PROMPT_DOM_CHARS = 40_000;

// The offline candidate ranking (rank.ts) produces a small shortlist of
// selectors that fit the failing test. The shortlist is ALWAYS added when
// non-empty (it is tiny, and helps every model) — so the prompt input DOES
// change for every heal, but it never replaces the DOM and the model must still
// ground its edit in the capture (resolve/rerun verify; worst case is give-up,
// never a wrong heal).
//
// Separately, when the capture OVERFLOWS the DOM budget AND the top candidate is
// STRONGLY confident, we shrink the embedded DOM and window it on the candidate:
// the whole prompt drops from ~50K tokens to a few K, which is what lets a small
// self-hosted model heal a deep page. This shrink is NOT strictly additive — a
// confidently-wrong ranking could window away a target the full no-anchor slice
// would have shown, turning that heal into a give-up (not a wrong heal). So it
// is gated on a HIGH confidence bar (only fires when the ranker is quite sure),
// and the full shortlist is still present for the model to pick from. A page
// that fits the budget, or a shortlist below the shrink bar, keeps the full
// windowDom behavior unchanged. See AGENTS.md for the accepted tradeoff.
const SHORTLIST_SHRINK_CONFIDENT = 0.7;
const SHORTLIST_DOM_CHARS = 24_000;

/** Render the ranked shortlist as a compact, model-readable block. */
function renderShortlist(cands: Candidate[]): string {
  const lines = cands.map((c, i) => {
    const sample = c.sampleText ? ` — “${c.sampleText.replace(/\s+/g, ' ').slice(0, 60)}”` : '';
    const why = c.why.length ? `  [${c.why.join('; ')}]` : '';
    return `${i + 1}. ${c.selector} — ${c.count} match${c.count === 1 ? '' : 'es'}${sample}${why}`;
  });
  return `## Candidate selectors (ranked offline by fit to the failing test)
Each already exists in the captured DOM, with its match count and a text sample. Prefer the candidate whose element is what the test targeted — read the samples to disambiguate (e.g. a title link vs its containing card). The DOM below is authoritative and may be trimmed; do NOT invent a selector that is neither listed here nor visible in the DOM.
${lines.join('\n')}
`;
}

export interface PromptInput {
  artifact: FailureArtifact;
  specSource: string;
  selectorPriority: string[];
  feedback?: string;
}

export function buildRepairPrompt({ artifact, specSource, selectorPriority, feedback }: PromptInput): string {
  const candidates = rankCandidates({
    failedSelector: artifact.failedSelector,
    specSource,
    domHtml: artifact.domHtml,
    ariaSnapshot: artifact.ariaSnapshot,
  });
  const overflows = deboilerplateDom(artifact.domHtml).length > MAX_PROMPT_DOM_CHARS;
  const shrink = overflows && candidates.length > 0 && candidates[0].score >= SHORTLIST_SHRINK_CONFIDENT;
  const { html: dom } = windowDom(artifact.domHtml, {
    failedSelector: artifact.failedSelector,
    specSource,
    budget: shrink ? SHORTLIST_DOM_CHARS : MAX_PROMPT_DOM_CHARS,
    // On shrink, window the DOM on the strongly-confident candidates so the small
    // budget yields the content region (not the deep no-anchor nav dump). Only
    // above-bar candidates anchor — a low-scoring filler/nav class could
    // otherwise pin the window on chrome. dom-window's head gate ignores these,
    // so an early candidate can never truncate the window to a head slice.
    anchorSelectors: shrink
      ? candidates.filter((c) => c.score >= SHORTLIST_SHRINK_CONFIDENT).slice(0, 3).map((c) => c.selector)
      : undefined,
  });
  const shortlist = candidates.length ? `\n${renderShortlist(candidates)}` : '';

  const prompt = `You repair broken selectors in Cypress tests. A test failed because a selector no longer matches the page. Propose the minimal edit to the spec file that points the selector at the intended element.

Rules (non-negotiable):
- Selector-only: change nothing but the selector string. Never touch assertions, timeouts, test logic, or add/remove lines.
- Exact-string edits: each oldString must appear exactly once in the spec, verbatim; newString differs only inside the selector string.
- If the broken selector appears in several places, emit one edit per occurrence (include enough surrounding text to make each oldString unique). Fix only occurrences of THIS break — nothing speculative.
- Prefer selectors in this order: ${selectorPriority.join(' > ')}.
- In replacement selectors, write attribute values WITHOUT inner quotes when they are plain identifiers — [data-testid=add-to-cart], not [data-testid="add-to-cart"]. CSS allows it, and it avoids JSON string-escaping mistakes.
- If the page never loaded (url about:blank), the capture is degraded, or no plausible target element exists, give up. Giving up is a correct answer.

Reply with ONLY a JSON object, no prose, no code fences:
{"edits":[{"file":"<spec path>","oldString":"<verbatim snippet>","newString":"<snippet with fixed selector>"}],"confidence":<0..1>,"reasoning":"<one paragraph>"}
or
{"giveUp":{"reason":"<why>"},"reasoning":"<one paragraph>"}

## Failure
- Test: ${artifact.title}
- Spec: ${artifact.specPath}
- Error: ${artifact.errorMessage}
${artifact.failedSelector ? `- Broken selector (parsed from the error): ${artifact.failedSelector}\n` : ''}- URL at failure: ${artifact.url}
${feedback ? `\n## Feedback from previous rejected attempt\n${feedback}\n` : ''}
## Spec source (${artifact.specPath})
\`\`\`ts
${specSource}
\`\`\`

## Accessibility tree at failure
\`\`\`yaml
${artifact.ariaSnapshot || '(unavailable)'}
\`\`\`
${shortlist}
## DOM at failure (redacted)
\`\`\`html
${dom}
\`\`\`
`;

  trace('prompt:build', shrink ? 'built (shrunk)' : 'built', () => ({
    promptChars: prompt.length,
    domChars: dom.length,
    overflows,
    shrink,
    candidateCount: candidates.length,
    topCandidate: candidates[0]?.selector,
    topScore: candidates[0]?.score,
    targetInDom: candidates[0] ? dom.includes(candidates[0].selector.replace(/^[.#]|^\[[\w-]+=|\]$/g, '')) : undefined,
  }));
  // Ring 2 (wide field): the full prompt bytes, for hunting a redaction leak in
  // exactly what reaches the model. Only emitted under GOLDSEAM_TRACE_RING>=2.
  trace('prompt:full', 'prompt', () => ({ prompt }), 2);
  return prompt;
}
