// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { maskText, redactedOuterHtml, stripAriaControlValues } from '../src/support/redact';

describe('maskText', () => {
  it('masks emails', () => {
    expect(maskText('contact jane.doe+test@example.co.uk now')).toBe(
      'contact [redacted-email] now',
    );
  });

  it('masks long digit runs (phone/card/account shaped)', () => {
    expect(maskText('call 5551234567')).toBe('call [redacted-number]');
    expect(maskText('card 4111 1111 1111 1111')).toBe('card [redacted-number]');
    expect(maskText('acct 12-34-56-78-90')).toBe('acct [redacted-number]');
  });

  it('leaves short numbers alone (prices, years, quantities)', () => {
    expect(maskText('$19.99 in 2026, qty 3')).toBe('$19.99 in 2026, qty 3');
  });

  it('masks JWTs', () => {
    expect(
      maskText('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpM'),
    ).toBe('Bearer [redacted-jwt]');
  });

  it('masks long hex and base64-shaped tokens', () => {
    expect(maskText('sid=d41d8cd98f00b204e9800998ecf8427ed41d8cd9')).toBe('sid=[redacted-token]');
    expect(maskText('hash d41d8cd98f00b204e9800998ecf8427e end')).toBe('hash [redacted-token] end');
    expect(maskText('blob QmFzZTY0VG9rZW5XaXRoRGlnaXRzMTIzNDU2Nzg5MEFCQ0RFRg here')).toBe(
      'blob [redacted-token] here',
    );
  });

  it('does not mask long plain words without digits', () => {
    const word = 'Supercalifragilisticexpialidociousandthensomemore';
    expect(maskText(word)).toBe(word);
  });

  it('masks sensitive query-string values but keeps the keys', () => {
    expect(maskText('https://x.test/cb?access_token=abc123&state=ok')).toBe(
      'https://x.test/cb?access_token=[redacted]&state=ok',
    );
    expect(maskText('href="/reset?token=xyz789&lang=en"')).toBe('href="/reset?token=[redacted]&lang=en"');
  });
});

describe('stripAriaControlValues', () => {
  it('strips inline text-control values but keeps role, name, labels, structure', () => {
    const aria = [
      '- text: Full name',
      '- textbox "Full name": John Q Secretson',
      '- textbox "Pw": hunter2pw',
      '- textbox: dear diary my secret plan',
      '- searchbox "Query": my private search',
      '- button "Buy now"',
      '- combobox:',
      '  - option "Bravo" [selected]',
    ].join('\n');
    const out = stripAriaControlValues(aria);
    // typed values gone
    expect(out).not.toContain('John Q Secretson');
    expect(out).not.toContain('hunter2pw');
    expect(out).not.toContain('secret plan');
    expect(out).not.toContain('my private search');
    // role + accessible name + surrounding structure kept
    expect(out).toContain('- textbox "Full name"');
    expect(out).toContain('- textbox "Pw"');
    expect(out).toContain('- searchbox "Query"');
    expect(out).toContain('- text: Full name'); // a label text node, not a form value — kept
    expect(out).toContain('- button "Buy now"'); // button label — kept
    expect(out).toContain('  - option "Bravo" [selected]'); // structural combobox children — kept
  });

  it('is a no-op on a snapshot with no inline control values', () => {
    const aria = '- heading "Welcome" [level=1]\n- list:\n  - listitem: shop item';
    expect(stripAriaControlValues(aria)).toBe(aria);
  });
});

describe('redactedOuterHtml', () => {
  it('strips values from text-entry controls but keeps button labels', () => {
    document.body.innerHTML = `
      <input type="text" value="secret plans">
      <input type="password" value="hunter2">
      <input type="submit" value="Buy now">
      <textarea>dear diary</textarea>`;
    const html = redactedOuterHtml(document.body);
    expect(html).not.toContain('secret plans');
    expect(html).not.toContain('hunter2');
    expect(html).not.toContain('dear diary');
    expect(html).toContain('Buy now');
  });

  it('masks emails and digit runs in text nodes and attributes', () => {
    document.body.innerHTML =
      '<div data-user="bob@corp.com" title="ref 9876543210">Email us at help@shop.io</div>';
    const html = redactedOuterHtml(document.body);
    expect(html).not.toContain('bob@corp.com');
    expect(html).not.toContain('help@shop.io');
    expect(html).not.toContain('9876543210');
    expect(html).toContain('[redacted-email]');
    expect(html).toContain('[redacted-number]');
  });

  it('masks pattern-matching secrets inside HTML comment nodes (light DOM and shadow content)', () => {
    // Comments serialize into domHtml via outerHTML and are sent to the model;
    // their node type was being skipped by the redaction walker.
    document.body.innerHTML =
      '<div id="host">visible</div><!-- ops note: card 4111111111111111 / admin@corp.com -->';
    document.getElementById('host')!.attachShadow({ mode: 'open' }).innerHTML =
      '<!-- shadow secret token 9876543210 -->';
    const html = redactedOuterHtml(document.body);
    expect(html).not.toContain('4111111111111111');
    expect(html).not.toContain('admin@corp.com');
    expect(html).not.toContain('9876543210'); // masked inside the shadow template too
    expect(html).toContain('[redacted-number]');
    expect(html).toContain('[redacted-email]');
    expect(html).toContain('<!--'); // the comment node is preserved (structure), only its data masked
    expect(html).toContain('visible');
  });

  it('never mutates the live DOM', () => {
    document.body.innerHTML = '<p>mail me: a@b.com</p><input value="keep">';
    redactedOuterHtml(document.body);
    expect(document.body.innerHTML).toContain('a@b.com');
    expect(document.querySelector('input')!.getAttribute('value')).toBe('keep');
  });

  it('serializes open shadow roots as declarative templates, redacted', () => {
    document.body.innerHTML = '<div id="host"></div><p>light dom</p>';
    const host = document.getElementById('host')!;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<button data-user="shadow@secret.com">Inside shadow</button>';
    const html = redactedOuterHtml(document.body);
    expect(html).toContain('<template shadowrootmode="open">');
    expect(html).toContain('Inside shadow');
    expect(html).toContain('light dom');
    expect(html).not.toContain('shadow@secret.com');
    expect(html).toContain('[redacted-email]');
    // live DOM untouched, shadow content still live
    expect(root.querySelector('button')!.getAttribute('data-user')).toBe('shadow@secret.com');
  });

  it('handles nested shadow roots', () => {
    document.body.innerHTML = '<div id="outer"></div>';
    const outer = document.getElementById('outer')!.attachShadow({ mode: 'open' });
    const inner = document.createElement('span');
    outer.appendChild(inner);
    inner.attachShadow({ mode: 'open' }).innerHTML = '<em>deep</em>';
    const html = redactedOuterHtml(document.body);
    expect(html.match(/<template shadowrootmode="open">/g)).toHaveLength(2);
    expect(html).toContain('<em>deep</em>');
  });
});
