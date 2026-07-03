// The repair prompt. This file and the RepairReply type are the same doc
// family as the artifact schema — the prompt contract is a public API.
//
// Invariant enforced here: the model sees the capture (runtime snapshots)
// and the spec source. Never application source.

import { FailureArtifact } from '../shared/types';

const MAX_PROMPT_DOM_CHARS = 40_000;

export interface PromptInput {
  artifact: FailureArtifact;
  specSource: string;
  selectorPriority: string[];
  feedback?: string;
}

export function buildRepairPrompt({ artifact, specSource, selectorPriority, feedback }: PromptInput): string {
  const dom =
    artifact.domHtml.length > MAX_PROMPT_DOM_CHARS
      ? `${artifact.domHtml.slice(0, MAX_PROMPT_DOM_CHARS)}\n<!-- truncated for prompt -->`
      : artifact.domHtml;

  return `You repair broken selectors in Cypress tests. A test failed because a selector no longer matches the page. Propose the minimal edit to the spec file that points the selector at the intended element.

Rules (non-negotiable):
- Selector-only: change nothing but the selector string. Never touch assertions, timeouts, test logic, or add/remove lines.
- Exact-string edits: each oldString must appear exactly once in the spec, verbatim; newString differs only inside the selector string.
- If the broken selector appears in several places, emit one edit per occurrence (include enough surrounding text to make each oldString unique). Fix only occurrences of THIS break — nothing speculative.
- Prefer selectors in this order: ${selectorPriority.join(' > ')}.
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
