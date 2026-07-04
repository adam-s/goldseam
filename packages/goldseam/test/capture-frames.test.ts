// @vitest-environment jsdom
// Frame-piercing capture: same-origin iframe documents are inlined as
// sibling <template data-frame-content> markup, redacted like everything
// else, and visible to the resolve rung and the aria snapshot.

import { describe, expect, it } from 'vitest';
import { ariaSnapshot } from 'aria-snapshot';
import { cloneWithShadow } from '../src/support/shadow';
import { redactedOuterHtml } from '../src/support/redact';
import { countSelectorMatches, countTextMatches } from '../src/heal/resolve';

// No src on the fixture iframes: jsdom starts a navigation for src'd
// frames and nulls contentDocument. Real capture reads whatever document
// is live at failure time, so a ready about:blank frame is the honest
// jsdom stand-in; provenance (data-frame-src) is pinned separately.
function pageWithFrame(frameHtml: string): void {
  document.body.innerHTML = '<button id="top">Top</button><iframe id="pay"></iframe>';
  const frame = document.getElementById('pay') as HTMLIFrameElement;
  frame.contentDocument!.body.innerHTML = frameHtml;
}

describe('same-origin iframe capture', () => {
  it('inlines frame content as a sibling template', () => {
    pageWithFrame('<button class="pay-btn">Pay now</button>');
    const html = cloneWithShadow(document.documentElement).outerHTML;
    expect(html).toContain('data-frame-content');
    expect(html).toContain('Pay now');
    // parse round-trip: the template must be a SIBLING of the iframe
    // (templates inside <iframe> are parsed as text and lost)
    expect(html).toMatch(/<\/iframe><template data-frame-content/);
  });

  it('records the frame src as provenance when present', () => {
    pageWithFrame('<i>x</i>');
    const frame = document.getElementById('pay') as HTMLIFrameElement;
    // jsdom navigates (and nulls contentDocument) if src is really set, so
    // stub the read: capture only ever getAttribute()s it.
    const original = frame.getAttribute.bind(frame);
    frame.getAttribute = (name: string) => (name === 'src' ? '/checkout-frame' : original(name));
    const html = cloneWithShadow(document.documentElement).outerHTML;
    expect(html).toContain('data-frame-src="/checkout-frame"');
  });

  it('redacts inside frame content like everywhere else', () => {
    pageWithFrame('<p>Contact bob@example.com</p><input value="4111111111111111">');
    const html = redactedOuterHtml(document.documentElement);
    expect(html).toContain('[redacted-email]');
    expect(html).not.toContain('bob@example.com');
    expect(html).not.toContain('4111111111111111');
  });

  it('shadow roots inside frame content survive the clone', () => {
    pageWithFrame('<div id="host"></div>');
    const frame = document.getElementById('pay') as HTMLIFrameElement;
    const host = frame.contentDocument!.getElementById('host')!;
    host.attachShadow({ mode: 'open' }).innerHTML = '<i id="deep">x</i>';
    const html = cloneWithShadow(document.documentElement).outerHTML;
    expect(html).toContain('shadowrootmode="open"');
    expect(html).toContain('id="deep"');
  });

  it('captures a same-origin iframe INSIDE a shadow root (red-team)', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
    const frame = document.createElement('iframe');
    shadow.appendChild(frame);
    if (!frame.contentDocument) return; // jsdom limitation guard — browser E2E covers it
    frame.contentDocument.body.innerHTML = '<button class="pay-btn">Pay now</button>';
    const html = cloneWithShadow(document.documentElement).outerHTML;
    expect(html).toContain('shadowrootmode="open"');
    expect(html).toContain('data-frame-content');
    expect(html).toContain('Pay now');
  });

  it('the resolve rung sees frame content in the serialized capture', () => {
    pageWithFrame('<button class="pay-btn">Pay now</button>');
    const captured = cloneWithShadow(document.documentElement).outerHTML;
    expect(countSelectorMatches(captured, '.pay-btn', 'none')).toMatchObject({ count: 1, approximate: false });
    expect(countTextMatches(captured, 'Pay now')).toBe(1);
  });

  it('the aria snapshot nests frame content under the iframe node', () => {
    pageWithFrame('<button>Pay now</button>');
    const yaml = ariaSnapshot(document.body, { frames: true });
    expect(yaml).toContain('Pay now');
  });
});
