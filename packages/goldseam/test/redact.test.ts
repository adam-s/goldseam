// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { maskText, redactedOuterHtml } from '../src/support/redact';

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

  it('never mutates the live DOM', () => {
    document.body.innerHTML = '<p>mail me: a@b.com</p><input value="keep">';
    redactedOuterHtml(document.body);
    expect(document.body.innerHTML).toContain('a@b.com');
    expect(document.querySelector('input')!.getAttribute('value')).toBe('keep');
  });
});
