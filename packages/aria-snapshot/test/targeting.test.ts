// @vitest-environment jsdom
// The targeting layer: aria names as addresses (getAllByAria), frame and
// serialized-template traversal, and element → selector derivation.

import { describe, expect, it } from 'vitest';
import {
  ariaSnapshot,
  deriveSelector,
  expandSerializedTemplates,
  getAllByAria,
  queryAllDeep,
} from '../src/index';

function page(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe('aria addressing (jsdom-pinned)', () => {
  it('getAllByAria resolves role+name to the element', () => {
    const body = page(
      '<header><span id="cc">0</span></header>' +
        '<button id="atc">Add to cart</button><button>Save draft</button>',
    );
    const els = getAllByAria(body, { kind: 'role', role: 'button', name: 'Add to cart' });
    expect(els).toHaveLength(1);
    expect(els[0].id).toBe('atc');
  });

  it('the snapshot and the address agree', () => {
    const body = page('<button>Pay now</button>');
    expect(ariaSnapshot(body)).toContain('button "Pay now"');
    expect(getAllByAria(body, { kind: 'role', role: 'button', name: 'Pay now' })).toHaveLength(1);
  });
});

describe('frame traversal', () => {
  function withFrame(): HTMLElement {
    const body = page('<button>Top</button><iframe id="pay"></iframe>');
    const frame = document.getElementById('pay') as HTMLIFrameElement;
    frame.contentDocument!.body.innerHTML = '<button>Pay now</button>';
    return body;
  }

  it('iframes are opaque leaves by default', () => {
    const yaml = ariaSnapshot(withFrame());
    expect(yaml).toContain('iframe');
    expect(yaml).not.toContain('Pay now');
  });

  it('frames:true descends same-origin content under the iframe node', () => {
    const body = withFrame();
    const yaml = ariaSnapshot(body, { frames: true });
    expect(yaml).toContain('Pay now');
    const els = getAllByAria(body, { kind: 'role', role: 'button', name: 'Pay now' }, { frames: true });
    expect(els).toHaveLength(1);
  });
});

describe('serialized captures (template conventions)', () => {
  const SERIALIZED =
    '<div id="host"><template shadowrootmode="open"><button>Buy</button></template></div>' +
    '<iframe id="pay"></iframe><template data-frame-content><button>Pay now</button></template>';

  it('the aria walk descends both template kinds', () => {
    const yaml = ariaSnapshot(page(SERIALIZED));
    expect(yaml).toContain('Buy');
    expect(yaml).toContain('Pay now');
  });

  it('getAllByAria addresses elements inside serialized content', () => {
    const els = getAllByAria(page(SERIALIZED), { kind: 'role', role: 'button', name: 'Pay now' });
    expect(els).toHaveLength(1);
  });

  it('queryAllDeep counts through templates without crossing boundaries', () => {
    const body = page(SERIALIZED);
    expect(queryAllDeep(body, 'button')).toHaveLength(2);
    // a descendant combinator must not reach INTO template content
    expect(queryAllDeep(body, 'body button')).toHaveLength(0 + 0); // buttons live only in templates
  });

  it('expandSerializedTemplates makes content plain-queryable', () => {
    const body = page(SERIALIZED);
    expandSerializedTemplates(body);
    expect(body.querySelectorAll('button')).toHaveLength(2);
    expect(body.querySelector('[data-shadow-content]')).toBeTruthy();
    expect(body.querySelector('[data-frame-content]')?.tagName).toBe('DIV');
  });

  it('expansion handles nested templates', () => {
    const body = page(
      '<template data-frame-content><div><template shadowrootmode="open"><i id="deep">x</i></template></div></template>',
    );
    expandSerializedTemplates(body);
    expect(body.querySelector('#deep')).toBeTruthy();
  });
});

describe('deriveSelector', () => {
  it('honors priority order: data-cy wins over everything', () => {
    const body = page('<button id="b1" data-cy="buy" data-testid="buy-t">Buy</button>');
    const t = deriveSelector(body.querySelector('button')!, { root: body });
    expect(t).toMatchObject({ kind: 'css', selector: '[data-cy="buy"]', strategy: 'data-cy' });
  });

  it('falls through non-unique attributes to the next strategy', () => {
    const body = page(
      '<button data-testid="dup" id="first">A</button><button data-testid="dup">B</button>',
    );
    const t = deriveSelector(body.querySelector('#first')!, { root: body });
    expect(t).toMatchObject({ selector: '#first', strategy: 'id' });
  });

  it('derives a cy.contains-shaped target from the accessible name', () => {
    const body = page('<button class="x">Add to cart</button><button class="x">Checkout</button>');
    const t = deriveSelector(body.querySelector('button')!, { root: body });
    expect(t).toMatchObject({ kind: 'contains', selector: 'button', text: 'Add to cart', strategy: 'text' });
  });

  it('refuses ambiguous text and falls to a structural path', () => {
    const body = page('<ul><li>Same</li><li>Same</li></ul>');
    const t = deriveSelector(body.querySelectorAll('li')[1], { root: body });
    expect(t?.kind).toBe('css');
    expect(t?.strategy).toBe('css');
    expect(queryAllDeep(body, t!.selector)).toHaveLength(1);
  });

  it('escapes attribute values', () => {
    const body = page('<div data-testid=\'a"b\'>x</div>');
    const t = deriveSelector(body.querySelector('div')!, { root: body });
    expect(t?.selector).toBe('[data-testid="a\\"b"]');
    expect(queryAllDeep(body, t!.selector)).toHaveLength(1);
  });

  it('derives selectors for elements inside serialized frame content', () => {
    const body = page(
      '<iframe></iframe><template data-frame-content><button data-testid="pay">Pay</button></template>',
    );
    const el = queryAllDeep(body, '[data-testid="pay"]')[0];
    const t = deriveSelector(el, { root: body });
    expect(t).toMatchObject({ selector: '[data-testid="pay"]', matches: 1 });
  });

  it('returns null when nothing unique exists within the cap', () => {
    const body = page('<i>a</i>');
    const el = body.querySelector('i')!;
    const t = deriveSelector(el, { root: body, priority: ['data-cy'] });
    expect(t).toBeNull();
  });
});
