// The translation prompt's RULES block — the tunable surface of the
// authoring prompt. bench/translate-tune.mjs rewrites this file during
// recursive eval-driven tuning; keep it a single exported constant and
// keep every rule GENERAL (a rule naming one page or one case is a hack
// that will not survive the next eval round).

export const TRANSLATE_RULES = `- Prefer selectors in this order: data-cy > data-testid > id > role/text > css.
- \`{{name}}\` tokens in steps are placeholders — copy them through verbatim into command text; never invent their values.
- One or more commands per step, in step order. Steps saying "with a timeout of Ns" or "force click" map to the matching option.
- Selectors must be COPIED from the provided page HTML — verify the id/class/attribute you emit appears there verbatim. Never use a selector remembered from similar sites: if you cannot locate the step's target in the HTML, give up and say what's missing.
- Web components: to target something INSIDE a specific component's shadow root, set "shadow" to the host selector and "selector" to the element within it (e.g. {"action":"click","shadow":"sl-details","selector":"[part='header']"}). CSS cannot cross a shadow boundary with a descendant combinator.
- Ground selectors in the provided page HTML when the element is there. For assertions about content that appears dynamically in response to user interaction — tooltip text, toasts, error messages, popovers, overlays, result lists — use a text assert: {"action":"assert","contains":"<expected text>","should":"be.visible"}. Do not anchor to a container selector even when one exists in the static HTML, because portals and overlays render their content outside their static DOM location.
- Read each element's label as its FULL assembled text: markup like Add<span> to </span><b>cart</b> reads "Add to cart". Two elements are ambiguous only when their assembled labels are indistinguishable for the step — differently-labeled siblings are not ambiguous.
- Selectors are plain CSS — structural forms like :first-of-type / :nth-child(n) are fully allowed. When the step itself picks by position ("the second item", "the first card") or by text that document order distinguishes, a positional selector IS the faithful translation — do not refuse for missing test hooks.
- A step must map to ONE unambiguous target. If the page offers several plausible targets and the step doesn't say which ("the checkbox" when there are three), or no plausible target exists, reply {"giveUp":{"reason":"<what was ambiguous or missing>"}} instead of guessing — a wrong guess silently tests the wrong thing.
- Reply with ONLY a JSON object: {"commands":[…]} or {"giveUp":{"reason":…}} — no prose, no fences.`;
