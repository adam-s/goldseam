# Packaging a professional Cypress plugin

The npm mechanics that separate the 1M-download plugins from abandoned
experiments. Target checklist for `packages/qa-relocator`.

## Entry points

Subpath exports, one per world, plus the CLI:

```jsonc
// package.json
{
  "name": "qa-relocator",
  "exports": {
    "./support": { "types": "./dist/support/index.d.ts", "default": "./dist/support/index.js" },
    "./plugin":  { "types": "./dist/plugin/index.d.ts",  "default": "./dist/plugin/index.js" },
    "./types":   { "types": "./dist/shared/types.d.ts",  "default": "./dist/shared/types.js" }
  },
  "bin": { "qa-relocator": "./dist/cli/index.js" },
  "peerDependencies": { "cypress": ">=12" },
  "files": ["dist", "NOTICE", "README.md"]
}
```

Decisions encoded there:

- **`./support` and `./plugin` are separate entries** so the browser bundle
  never contains Node code and vice versa. The shared types entry keeps the
  artifact schema importable by both plus third parties.
- **`cypress` is a peerDependency with a wide range.** Plugins that pin
  cypress break every upgrade; declare the floor you actually test.
- **`bin` makes the CLI real**: `npx qa-relocator heal`.

## Options design

- Every install function takes one optional options object:
  `installQaRelocator(options?)`, `qaRelocator(on, config, options?)`.
- **Zero-config must work.** Defaults are the product; options are the
  escape hatch. (Adoption pattern from `cypress-mochawesome-reporter`.)
- Validate options eagerly and fail loud at *setup* time, not mid-run.
- Config can also flow via `Cypress.env('qaRelocator')` for teams that
  prefer config-file-only wiring — read env as fallback, options as primary.

## The artifact schema is a public API

- Version it in the file: `{ "schemaVersion": 2, ... }`.
- Additive changes bump minor; breaking changes bump major *of the package*.
- Document every field — the schema doc is also the prompt-engineering doc,
  since the repair model consumes the same JSON.
- Redaction guarantees belong in the schema doc ("field values never
  captured; attributes matching these patterns stripped").

## TypeScript

- Ship `.d.ts` for everything; the support entry augments Cypress types
  where it adds commands (none planned initially).
- Source is TS, build to `dist/` (CJS is still the safe target for the
  plugin entry — the Cypress config loader and webpack preprocessor both
  consume it happily; `module: node16`).
- The workspace already proves the pipeline: `packages/aria-snapshot` builds
  exactly this way.

## Testing a plugin (the part everyone skips)

1. **Unit-test the Node side** (slug/hash/schema/writer) with vitest — pure
   functions, fast.
2. **Unit-test browser-side logic** where possible via jsdom (the
   aria-snapshot package tests this way upstream).
3. **System tests: a fixture Cypress project inside the repo** (our
   `demo/` + spec suite is exactly this) run in CI — one job green-path, one
   job broken-selector asserting the artifact appears and validates against
   the schema.
4. **Compatibility matrix:** CI jobs against the Cypress versions in the
   peer range floor/latest, and one job with the top-five plugins installed
   alongside.
5. **The capture rule test:** assert a *failing capture* still yields the
   original test error (our never-mask invariant) — this is the test that
   proves professionalism.

## Documentation bar (what 600K+/wk plugins have in common)

- README quickstart that works in 60 seconds: install, two wiring lines, run.
- A GIF or single screenshot of the payoff (for us: a healed-selector PR).
- Options reference table, one line per option, defaults shown.
- Compatibility statement (Cypress versions, browsers, known conflicts).
- A `troubleshooting` section pre-answering the classic failure
  (for us: "captures not appearing" → restart after config change, check
  task registration — we hit both in development; write them down).

## Release hygiene

- Conventional commits + changelog; every release note names the artifact
  schemaVersion it writes.
- `npm pack` inspection in CI (no stray files; NOTICE present — the
  aria-snapshot lift carries Apache-2.0 obligations).
- Submit to the Cypress plugins directory
  (docs.cypress.io/app/plugins/plugins-list) once stable — it's a PR to
  their docs repo; free discovery.
