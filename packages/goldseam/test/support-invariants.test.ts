// @vitest-environment jsdom
//
// The capture-rule tests: the invariants that make the plugin safe to put
// in front of someone's suite. A capture failure must never mask (or
// green-light) the real test failure, and green runs must stay silent.

import { beforeEach as vitestBeforeEach, describe, expect, it } from 'vitest';
import { CAPTURE_TASK, FailureCapture } from '../src/shared/types';

type Handler = (...args: any[]) => unknown;

const cypressListeners: Record<string, Handler[]> = {};
const hookFns: { beforeEach: Handler[]; afterEach: Handler[] } = {
  beforeEach: [],
  afterEach: [],
};
const taskCalls: Array<{ name: string; payload: FailureCapture }> = [];
let onCallCount = 0;
let domAccessible = true;
let currentRetry: number | undefined;

// jsdom doesn't implement getComputedStyle for pseudo-elements; the aria
// walk probes ::before/::after content. Shim it so green output stays clean.
const realGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((elt: Element, pseudo?: string | null) =>
  pseudo ? ({ content: 'none', display: 'inline' } as CSSStyleDeclaration) : realGetComputedStyle(elt)) as typeof window.getComputedStyle;

(globalThis as any).Cypress = {
  Commands: { add: () => {} }, // cy.goldseam registration — inert here
  env: () => undefined, // options env-merge reads Cypress.env('goldseam')
  on: (event: string, fn: Handler) => {
    onCallCount++;
    (cypressListeners[event] ??= []).push(fn);
  },
  listeners: (event: string) => cypressListeners[event] ?? [],
  get currentRetry() {
    return currentRetry;
  },
  $: () => {
    if (!domAccessible) throw new Error('boom: page unreachable');
    return [document.documentElement];
  },
  spec: { relative: 'cypress/e2e/fake.cy.ts' },
};
(globalThis as any).beforeEach = (fn: Handler) => hookFns.beforeEach.push(fn);
(globalThis as any).afterEach = (fn: Handler) => hookFns.afterEach.push(fn);
(globalThis as any).cy = {
  task: (name: string, payload: FailureCapture) => taskCalls.push({ name, payload }),
};

const { installGoldseam } = await import('../src/support/index');
installGoldseam();

const runnable = { fullTitle: () => 'suite > failing test' };
const failHandler = (...args: unknown[]) => cypressListeners.fail[0](...args);

function startTest() {
  hookFns.beforeEach.forEach((fn) => fn());
}
function endTest(state: 'failed' | 'passed', retries?: number) {
  hookFns.afterEach.forEach((fn) =>
    fn.call({ currentTest: { state, ...(retries !== undefined && { retries: () => retries }) } }),
  );
}

vitestBeforeEach(() => {
  taskCalls.length = 0;
  domAccessible = true;
  currentRetry = undefined;
  cypressListeners.fail.length = 1; // drop any extra listeners a test added
});

describe('transparency toward user fail handlers', () => {
  it('does not re-throw when another fail listener exists (their semantics win), but still stashes', () => {
    cypressListeners.fail.push(() => {}); // user's spec-level swallow handler
    startTest();
    const err = new Error('expected-by-user failure');
    expect(() => failHandler(err, runnable)).not.toThrow();

    // If the user's handler re-throws anyway, the test ends failed and the
    // capture still ships:
    endTest('failed');
    expect(taskCalls).toHaveLength(1);
    expect(taskCalls[0].payload.errorMessage).toBe('expected-by-user failure');
  });
});

describe('retries', () => {
  it('ships nothing on a non-final failed attempt', () => {
    startTest();
    currentRetry = 0;
    expect(() => failHandler(new Error('attempt 0'), runnable)).toThrow();
    endTest('failed', 2); // 2 retries allowed — a retry is coming
    expect(taskCalls).toHaveLength(0);
  });

  it('ships the capture on the final failed attempt', () => {
    startTest();
    currentRetry = 2;
    expect(() => failHandler(new Error('final attempt'), runnable)).toThrow();
    endTest('failed', 2);
    expect(taskCalls).toHaveLength(1);
    expect(taskCalls[0].payload.errorMessage).toBe('final attempt');
  });
});

describe('the never-mask invariant', () => {
  it('re-throws the original error after a healthy capture', () => {
    document.body.innerHTML = '<main><h1>Shop</h1><p>owner: a@b.com</p></main>';
    startTest();
    const err = new Error('Expected to find element: `[data-cy=missing]`');
    expect(() => failHandler(err, runnable)).toThrow(err);

    endTest('failed');
    expect(taskCalls).toHaveLength(1);
    const { name, payload } = taskCalls[0];
    expect(name).toBe(CAPTURE_TASK);
    expect(payload.errorMessage).toBe(err.message);
    expect(payload.title).toBe('suite > failing test');
    expect(payload.url).toBe(document.location.href);
    expect(payload.domHtml).toContain('<h1>Shop</h1>');
    expect(payload.redacted).toBe(true);
    expect(payload.domHtml).toContain('[redacted-email]');
    expect(payload.captureError).toBeUndefined();
  });

  it('never captures text-control values — DOM path AND aria snapshot (structural guarantee)', () => {
    document.body.innerHTML =
      '<label>Password<input type="password" value="hunter2pw"></label>' +
      '<label>Full name<input type="text" value="Jane Q Secretson"></label>' +
      '<textarea>dear diary my secret plan</textarea>';
    startTest();
    expect(() => failHandler(new Error('Expected to find element: `#go`'), runnable)).toThrow();
    endTest('failed');
    const { payload } = taskCalls[0];
    // typed values must reach the model through NEITHER path
    for (const secret of ['hunter2pw', 'Jane Q Secretson', 'secret plan']) {
      expect(payload.domHtml).not.toContain(secret);
      expect(payload.ariaSnapshot).not.toContain(secret);
    }
    // but the aria structure survives so the model can still reason about the form
    expect(payload.ariaSnapshot).toContain('textbox');
  });

  it('re-throws the original error even when capture itself explodes', () => {
    domAccessible = false;
    startTest();
    const err = new Error('the real assertion failure');
    expect(() => failHandler(err, runnable)).toThrow(err);

    endTest('failed');
    expect(taskCalls).toHaveLength(1);
    const { payload } = taskCalls[0];
    expect(payload.errorMessage).toBe('the real assertion failure');
    expect(payload.captureError).toContain('boom');
    expect(payload.domHtml).toBe('');
  });
});

describe('quiet on green', () => {
  it('ships nothing when the test passes', () => {
    startTest();
    endTest('passed');
    expect(taskCalls).toHaveLength(0);
  });
});

describe('idempotent install', () => {
  it('does not double-register handlers', () => {
    const before = onCallCount;
    installGoldseam();
    expect(onCallCount).toBe(before);
  });
});

describe('allowCypressEnv: false compatibility', () => {
  it('survives a Cypress.env() that throws (env options are optional sugar)', () => {
    // Cypress 15's allowCypressEnv: false makes Cypress.env() throw; a
    // support file that dies on it fails the whole suite at load
    // (demo-video finding — and Cypress plans to make false the default).
    const cypressGlobal = (globalThis as any).Cypress;
    const realEnv = cypressGlobal.env;
    cypressGlobal.env = () => {
      throw new Error('Cypress.env() is disabled by allowCypressEnv: false');
    };
    try {
      expect(() => installGoldseam()).not.toThrow();
    } finally {
      cypressGlobal.env = realEnv;
    }
  });
});
