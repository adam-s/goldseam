// The repair prompt. This file and the RepairReply type are the same doc
// family as the artifact schema — the prompt contract is a public API.
//
// Invariant enforced here: the model sees the capture (runtime snapshots)
// and the spec source. Never application source.

import { FailureArtifact } from '../shared/types';
import { deboilerplateDom, windowDom } from './dom-window';

// The prompt's DOM-slimming (style/script strip + anchored neighborhood
// window) lives in dom-window.ts; re-exported here because it is part of the
// prompt contract. See that file for the content-neutral / prompt-only
// invariants and the evidence behind the windowing gate.
export { deboilerplateDom };

const MAX_PROMPT_DOM_CHARS = 40_000;

export interface PromptInput {
  artifact: FailureArtifact;
  specSource: string;
  selectorPriority: string[];
  feedback?: string;
}

export function buildRepairPrompt({ artifact, specSource, selectorPriority, feedback }: PromptInput): string {
  const { html: dom } = windowDom(artifact.domHtml, {
    failedSelector: artifact.failedSelector,
    specSource,
    budget: MAX_PROMPT_DOM_CHARS,
  });

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

## DOM at failure (redacted)
\`\`\`html
${dom}
\`\`\`
`;
}
