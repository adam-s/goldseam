# Debug tracing — observing a heal's internal activity

Why this exists: "the heal gave up / picked the wrong selector" is unfalsifiable
from the outside. The trace spine turns one heal into a sortable timeline — what
the ranker scored, how big the prompt got and whether it shrank, what the model
replied, how each rung ruled — so a leak, a bug, or an inconsistency is a `grep`,
not a guess. It is the built-in form of the copy-to-`/tmp`, inject-`console.log`,
analyze-the-file workflow: the instrumentation already ships (opt-in), so the
"injection" is one env var.

## The invariant that lets it ship in prod code

OFF BY DEFAULT and free when off. With `GOLDSEAM_TRACE` unset, every `trace()`
call is a single env check that returns — the heal behaves byte-identically with
and without the flag (the transparency invariant). It writes only to a debug
file (never the artifacts), builds its payload lazily (never when off), and NEVER
throws. Pinned in [trace.test.ts](../../packages/goldseam/test/trace.test.ts).

## Turn it on

```
GOLDSEAM_TRACE=1            # enable
GOLDSEAM_TRACE_FILE=…       # converge target (default /tmp/goldseam-debug/trace.log)
GOLDSEAM_TRACE_RING=2       # max ring to emit (default 99 = all); 0 = narrowest
GOLDSEAM_TRACE_STDERR=1     # also mirror to stderr (default off)
```

Each line is `<ISO-ms> <corr> r<ring> <location> <message> <json?>` — timestamp
first, so `sort` on the file yields true ordering, and `<corr>` groups the lines
of one heal.

## The rings (concentric / adaptive)

- **ring 0** — closest to the issue, on by default at any RING: `heal:start`,
  `ladder:<stage>` (every rung's verdict), `propose:prompt` / `propose:reply`,
  `prompt:build` (prompt/DOM sizes, `shrink`, top candidate + score).
- **ring 1** — a wider field: `rank:candidates` (the full scored shortlist).
- **ring 2** — the whole layer, opt-in with `GOLDSEAM_TRACE_RING=2`:
  `prompt:full` emits the entire prompt bytes — for hunting a redaction leak in
  exactly what reaches the model.

Start narrow (ring 0). Widen only when the narrow ring didn't reveal it — a huge
`prompt:full` per heal is noise until you need it.

## Analyze

- **Leaks** — with RING=2, `grep` the `prompt:full` lines for any secret the
  capture should have masked (email, JWT, hex/base64 token, digit run, sensitive
  query param). If a real capture leaks one, redaction has a gap. (When testing
  a hand-built artifact, remember the *capture* masks `artifact.url` via
  `maskText` — a fixture that skips that will show a false positive.)
- **Bugs / inconsistencies** — read the ring-0 timeline: does `prompt:build`'s
  `topCandidate` match what `rank:candidates` ranked #1? Did `shrink` fire when
  you expected (overflow + top score ≥ 0.7)? Did `ladder:resolve` reject a count
  the model proposed? Does `propose:reply` carry the selector the shortlist named?

## Ad-hoc deeper tracing

For a suspect the permanent ring-0 points don't cover, import the spine and drop
a call at the code — narrowest ring, closest to the issue:

```ts
import { trace } from '../debug/trace';
trace('resolve:count', 'matched', () => ({ selector, count }), 0);
```

Do it in a `/tmp` copy or a git worktree so the tree stays clean, or add it,
trace, and revert. The spine is the same one shipped, so no wiring is needed.
