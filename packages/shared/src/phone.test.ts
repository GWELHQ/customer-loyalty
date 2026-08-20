import { describe, expect, it } from 'vitest';
import { isValidPhoneNumber, normalizePhoneNumber, PhoneNormalizationError } from './phone.js';

describe('normalizePhoneNumber', () => {
  it('normalizes a 07... local number', () => {
    expect(normalizePhoneNumber('0712345678')).toBe('+254712345678');
  });

  it('normalizes a 01... local number', () => {
    expect(normalizePhoneNumber('0112345678')).toBe('+254112345678');
  });

  it('normalizes a bare national number without leading zero', () => {
    expect(normalizePhoneNumber('712345678')).toBe('+254712345678');
  });

  it('normalizes an already-international number', () => {
    expect(normalizePhoneNumber('+254712345678')).toBe('+254712345678');
  });

  it('normalizes an international number without the plus', () => {
    expect(normalizePhoneNumber('254712345678')).toBe('+254712345678');
  });

  it('strips spaces, dashes and parentheses', () => {
    expect(normalizePhoneNumber('0712 345 678')).toBe('+254712345678');
    expect(normalizePhoneNumber('+254 (712) 345-678')).toBe('+254712345678');
  });

  it('produces the same normalized value for equivalent inputs (dedup guarantee)', () => {
    const variants = ['0712345678', '712345678', '+254712345678', '254712345678', '0712-345-678'];
    const normalized = new Set(variants.map(normalizePhoneNumber));
    expect(normalized.size).toBe(1);
  });

  it('throws on an empty string', () => {
    expect(() => normalizePhoneNumber('')).toThrow(PhoneNormalizationError);
  });

  it('throws on a non-Kenyan-mobile number', () => {
    expect(() => normalizePhoneNumber('0203456789')).toThrow(PhoneNormalizationError);
  });

  it('throws on too few digits', () => {
    expect(() => normalizePhoneNumber('07123')).toThrow(PhoneNormalizationError);
  });
});

describe('isValidPhoneNumber', () => {
  it('returns true for valid numbers and false for invalid ones', () => {
    expect(isValidPhoneNumber('0712345678')).toBe(true);
    expect(isValidPhoneNumber('not a phone')).toBe(false);
  });
});
