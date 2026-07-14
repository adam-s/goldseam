// The repair prompt. This file and the RepairReply type are the same doc
// family as the artifact schema — the prompt contract is a public API.
//
// Invariant enforced here: the model sees the capture (runtime snapshots)
// and the spec source. Never application source.

import { FailureArtifact } from '../shared/types';
import { deboilerplateDom, windowDom } from './dom-window';
import { Candidate, rankCandidates } from './rank';

// The prompt's DOM-slimming (style/script strip + anchored neighborhood
// window) lives in dom-window.ts; re-exported here because it is part of the
// prompt contract. See that file for the content-neutral / prompt-only
// invariants and the evidence behind the windowing gate.
export { deboilerplateDom };

const MAX_PROMPT_DOM_CHARS = 40_000;

// The offline candidate ranking (rank.ts) produces a small shortlist of
// selectors that fit the failing test. When the capture OVERFLOWS the DOM budget
// AND that shortlist is confident, we embed a SMALLER DOM window: the shortlist
// already carries the plausible answers, so a compact DOM is enough for the
// model to sanity-check, and the whole prompt drops from ~50K tokens to a few K
// — which is what lets a small self-hosted model heal a deep page. A page that
// fits the budget, or a low-confidence shortlist, keeps the full window
// unchanged (zero change for the heals that work today). The shortlist is
// ALWAYS shown when non-empty (it is tiny); it never replaces the DOM, and the
// model must still ground its edit in the capture — resolve/rerun verify.
const SHORTLIST_CONFIDENT = 0.5;
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
  const confident = candidates.length > 0 && candidates[0].score >= SHORTLIST_CONFIDENT;
  const budget = overflows && confident ? SHORTLIST_DOM_CHARS : MAX_PROMPT_DOM_CHARS;
  const { html: dom } = windowDom(artifact.domHtml, {
    failedSelector: artifact.failedSelector,
    specSource,
    budget,
    // With a confident shortlist, let the DOM window center on those candidates
    // so the small budget yields the content region (not the deep no-anchor
    // nav dump). Only CONFIDENT candidates anchor — a low-scoring filler class
    // (repeated nav chrome) could otherwise sit in the head slice and pin the
    // window on the chrome instead of the content.
    anchorSelectors: confident
      ? candidates.filter((c) => c.score >= SHORTLIST_CONFIDENT).slice(0, 3).map((c) => c.selector)
      : undefined,
  });
  const shortlist = candidates.length ? `\n${renderShortlist(candidates)}` : '';

  return `You repair broken selectors in Cypress tests. A test failed because a selector no longer matches the page. Propose the minimal edit to the spec file that points the selector at the intended element.

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
}
