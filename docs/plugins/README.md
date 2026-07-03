# Cypress plugin engineering — knowledge base

Everything qa-relocator needs to know to ship a professional Cypress plugin,
collected 2026-07-03. Each file stands alone; together they are the design
input for `packages/qa-relocator`.

| File | Contents |
| --- | --- |
| [extension-points.md](extension-points.md) | The complete catalog of ways to extend Cypress — both worlds, plus what is *not* extensible |
| [patterns.md](patterns.md) | The five plugin paradigms, with case studies from the highest-download plugins and composition/citizenship rules |
| [packaging.md](packaging.md) | npm mechanics: entry points, types, options design, versioning, testing, docs bar |
| [cy-prompt-anatomy.md](cy-prompt-anatomy.md) | How the incumbent works under the hood — first-party evidence from the shipped binary, public API + version timeline |
| [cy-prompt-usage.md](cy-prompt-usage.md) | How people use cy.prompt in the wild — 35 usage patterns from the full issue-queue sweep, mapped to demo-shop widgets and the benchmark's selector-style axis |
| [qa-relocator-blueprint.md](qa-relocator-blueprint.md) | Our product: target API, artifact schema, model-runner interface, roadmap |
| [verification-ladder.md](verification-ladder.md) | Phased heal-verification design: how Adam's red-team/adversary/snapshot/eval skills fold in as config, not refactors |

## The one-paragraph thesis

A Cypress "plugin" is nothing but an npm package that hooks documented
extension points in one or both of Cypress's two worlds (browser support
file, Node `setupNodeEvents`). The professional bar — set by plugins doing
0.3–1.3M downloads/week — is: install in two lines, zero required config,
typed options objects, minimal and composable event footprint, and (for
anything that produces output) artifact files on disk as the contract
between the test run and downstream tooling. qa-relocator's winning shape is
the **collector → bridge → artifact → CLI** pipeline: capture in the run,
heal after it, deliver as a PR.
