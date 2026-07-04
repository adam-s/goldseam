# Proving ground: Shoelace docs

Web components at scale — every sl-* element renders into an open shadow
root; the suite uses the canonical `.shadow().find()` culture with
`includeShadowDom`. Local-only.

## Boot

```bash
git clone --depth 20 https://github.com/shoelace-style/shoelace /tmp/goldseam-proving/shoelace
cd /tmp/goldseam-proving/shoelace && npm install && npm start   # port 4000
```

## Run

```bash
env -u ELECTRON_RUN_AS_NODE npx cypress run --config-file proving/shoelace/cypress.config.ts
node packages/goldseam/dist/cli/index.js heal --model claude --config-file proving/shoelace/cypress.config.ts
```

Drift: rename `dialog__panel→dialog__frame` in
`src/components/dialog/dialog.{styles,component}.ts` — esbuild watch
rebuilds (editing built chunks is futile; the watcher regenerates them).

## Results (2026-07-04)

- Green baseline 2/2. Building the suite hit Cypress's own shadow
  limits live: descendant combinators don't cross shadow boundaries even
  with includeShadowDom, and the visibility engine misjudges
  fixed-position shadow content (cypress#33046) — existence assertions +
  `.shadow().find()` are the honest culture.
- Shadow drift heal: the capture carried **185 serialized shadow roots**
  (the cypress#8843 "snapshots don't include shadow DOM" proof) with the
  renamed class visible inside shadow content. Sonnet healed
  `.dialog__panel` → `[part="panel"]` — the component's documented
  public API rather than the renamed internal class (0.92, one attempt,
  full ladder). Triage correctly skipped (scoped `.find()` failure);
  resolve applied scoped existence-only semantics (8 matches).
