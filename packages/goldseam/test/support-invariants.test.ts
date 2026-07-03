// @vitest-environment jsdom
//
// The capture-rule tests: the invariants that make the plugin safe to put
// in front of someone's suite. A capture failure must never mask (or
// green-light) the real test failure, and green runs must stay silent.

import { beforeEach as vitestBeforeEach, describe, expect, it } from 'vitest';
import { CAPTURE_TASK, FailureCapture } from '../src/shared/types';

type Handler = (...args: any[]) => unknown;

const cypressHandlers: Record<string, Handler> = {};
const hookFns: { beforeEach: Handler[]; afterEach: Handler[] } = {
  beforeEach: [],
  afterEach: [],
};
const taskCalls: Array<{ name: string; payload: FailureCapture }> = [];
let onCallCount = 0;
let domAccessible = true;

// jsdom doesn't implement getComputedStyle for pseudo-elements; the aria
// walk probes ::before/::after content. Shim it so green output stays clean.
const realGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((elt: Element, pseudo?: string | null) =>
  pseudo ? ({ content: 'none', display: 'inline' } as CSSStyleDeclaration) : realGetComputedStyle(elt)) as typeof window.getComputedStyle;

(globalThis as any).Cypress = {
  on: (event: string, fn: Handler) => {
    onCallCount++;
    cypressHandlers[event] = fn;
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

function startTest() {
  hookFns.beforeEach.forEach((fn) => fn());
}
function endTest(state: 'failed' | 'passed') {
  hookFns.afterEach.forEach((fn) => fn.call({ currentTest: { state } }));
}

vitestBeforeEach(() => {
  taskCalls.length = 0;
  domAccessible = true;
});

describe('the never-mask invariant', () => {
  it('re-throws the original error after a healthy capture', () => {
    document.body.innerHTML = '<main><h1>Shop</h1><p>owner: a@b.com</p></main>';
    startTest();
    const err = new Error('Expected to find element: `[data-cy=missing]`');
    expect(() => cypressHandlers.fail(err, runnable)).toThrow(err);

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

  it('re-throws the original error even when capture itself explodes', () => {
    domAccessible = false;
    startTest();
    const err = new Error('the real assertion failure');
    expect(() => cypressHandlers.fail(err, runnable)).toThrow(err);

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
