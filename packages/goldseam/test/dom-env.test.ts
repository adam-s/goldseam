// The jsdom parse lifecycle. parseDom hands the caller a window it must
// release; closeWindow / withParsedDom are that release, and they must be
// total (undefined, double-close, a throwing close() all become no-ops) so
// that freeing memory can never itself fail a heal. The offline rungs
// (resolve, oracle, windowDom) route every parse through these — a leak here
// is a footgun for any future tight-loop caller (a synchronous parse loop
// with no event-loop turn OOMs jsdom), so the release is pinned, not assumed.

import { describe, expect, it } from 'vitest';
import { closeWindow, parseDom, withParsedDom } from '../src/heal/dom-env';

describe('closeWindow', () => {
  it('calls close() on the window exactly once', () => {
    let calls = 0;
    closeWindow({ document: {} as Document, close: () => calls++ });
    expect(calls).toBe(1);
  });

  it('is a no-op on undefined — a skipped parse frees nothing, never throws', () => {
    expect(() => closeWindow(undefined)).not.toThrow();
  });

  it('swallows a throwing close() — releasing memory must not fail the heal', () => {
    expect(() =>
      closeWindow({
        document: {} as Document,
        close: () => {
          throw new Error('jsdom hiccup');
        },
      }),
    ).not.toThrow();
  });

  it('double-close on a real jsdom window is safe', () => {
    const { window } = parseDom('<html><body><div id="a"></div></body></html>');
    expect(() => {
      closeWindow(window);
      closeWindow(window);
    }).not.toThrow();
  });
});

describe('withParsedDom', () => {
  it('returns the callback value and closes the window afterward', () => {
    let closed = false;
    const count = withParsedDom('<div class="x"></div><div class="x"></div>', (document, window) => {
      // Wrap close so we can prove the finally fired without relying on a
      // jsdom `closed` flag (jsdom stops timers but does not set it).
      const real = window.close?.bind(window);
      window.close = () => {
        closed = true;
        real?.();
      };
      return document.querySelectorAll('.x').length;
    });
    expect(count).toBe(2);
    expect(closed).toBe(true);
  });

  it('closes the window even when the callback throws', () => {
    let closed = false;
    expect(() =>
      withParsedDom('<div></div>', (_document, window) => {
        const real = window.close?.bind(window);
        window.close = () => {
          closed = true;
          real?.();
        };
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(closed).toBe(true);
  });
});
