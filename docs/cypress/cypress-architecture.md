# Cypress architecture — how the pieces talk

Reference for qa-relocator M1/M2. Four views: frame anatomy, comms
channels, the M1 capture pipeline, and the M2 CDP borrow.

## 1. Frame anatomy — who lives where

```mermaid
flowchart TD
    subgraph tab["Browser tab"]
        subgraph runner["Cypress runner — top window (Cypress's own origin)"]
            ui["Runner UI: command log, URL bar, viewport chrome"]
            subgraph proxied["Proxied origin (appears same-origin as your app)"]
                spec["Spec frame (hidden iframe)<br/>your test code + command engine"]
                aut["AUT frame (visible iframe)<br/>your application"]
            end
        end
    end
    spec -- "direct DOM references<br/>(same origin, synchronous)" --> aut
    ui -. "renders events from" .-> spec
```

- **AUT** = Application Under Test (your app).
- The proxy rewrites all app traffic so spec + AUT share an origin — that's
  what makes direct cross-frame DOM access legal.
- Two `window`s / two `document`s: bare `document` in spec code is the
  **spec frame's**, not the app's. `cy.window()` / `Cypress.$` point at the AUT.
- How the spec frame gets its URL (and why it shares the app's origin):
  see [spec-frame-url.md](spec-frame-url.md).

## 2. Communication channels

```mermaid
flowchart LR
    runner["Runner UI<br/>(top window)"]
    spec["Spec frame<br/>(driver)"]
    aut["AUT frame<br/>(your app)"]
    server["Cypress Node server"]
    browser["Browser process"]
    net["Real network"]

    spec -- "1 direct object refs<br/>querySelector, dispatchEvent" --> aut
    aut -- "2 wiretap hooks<br/>error, load, console" --> spec
    spec -- "3 event bus<br/>command/test lifecycle" --> runner
    spec <-- "4 websocket<br/>cy.task, Cypress.automation" --> server
    server -- "5 CDP<br/>screenshots, viewport, native chores" --> browser
    aut -- "HTTP" --> server
    server -- "proxy (rewrites origin,<br/>strips X-Frame-Options)" --> net
```

| # | Link | Mechanism | Nature |
| --- | ---- | --------- | ------ |
| 1 | spec → AUT | direct JS references | synchronous, no messaging |
| 2 | AUT → spec | planted listeners | app doesn't know it's observed |
| 3 | spec → runner UI | event stream | `Cypress.on('fail')` subscribes here |
| 4 | spec ↔ server | websocket | only exit from the browser |
| 5 | server → browser | CDP | management side-channel, Chromium |

## 3. M1 — failure-capture pipeline

```mermaid
sequenceDiagram
    participant AUT as AUT frame (DOM)
    participant Spec as Spec frame (engine + hooks)
    participant WS as websocket
    participant Node as Node server (setupNodeEvents)
    participant FS as .qa-relocator/failures/

    Note over Spec: cy.get('#old-selector') exhausts retries
    Spec->>Spec: 'fail' event fires (mid-unwind)
    Spec->>AUT: read outerHTML via direct reference<br/>(AUT document, NOT bare document)
    Spec->>Spec: stash context + RE-THROW original error
    Note over Spec: no cy.* commands here — engine is unwinding
    Spec->>Spec: afterEach: currentTest.state === 'failed'
    Spec->>WS: cy.task('qa:capture', payload)
    WS->>Node: task handler receives payload
    Node->>FS: write <slug>.json
    Node-->>Spec: task resolves
```

Rules encoded in this diagram:

- **Stash + re-throw** in `fail` — never swallow, never enqueue commands.
- Capture is **best-effort**: any capture error must not mask the original failure.
- The stash lives only as long as the current test — durable record is Node's job.
- Green runs write nothing.

## 4. M2 — borrowing the server's CDP session

```mermaid
sequenceDiagram
    participant Spec as Spec frame
    participant WS as websocket
    participant Server as Node server
    participant CDP as CDP connection
    participant Browser as Browser (a11y tree)

    Spec->>WS: Cypress.automation('remote:debugger:protocol',<br/>{command: 'Accessibility.getFullAXTree'})
    WS->>Server: forward request
    Server->>CDP: replay down existing CDP session
    CDP->>Browser: Accessibility.getFullAXTree
    Browser-->>CDP: AX nodes
    CDP-->>Server: result
    Server-->>Spec: resolves in test code
```

Trade-off to justify in M2: this "live borrow" is Chromium-only and rides
semi-documented plumbing, vs. offline extraction (rehydrate captured DOM in a
headless page later) which runs in the repair harness, outside the failure
window. Either way the AX tree complements the DOM capture — the agent picks
the target semantically from the tree, but expresses the selector against the DOM.
