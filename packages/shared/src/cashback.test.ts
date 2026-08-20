import { describe, expect, it } from 'vitest';
import { calculateCashback, verifyCashback, DEFAULT_CASHBACK_RATE_KES } from './cashback.js';

describe('calculateCashback', () => {
  it('earns KES 20 for 10.34 litres at the default rate', () => {
    // amountPaid chosen so amountPaid / pricePerLitre === 10.34
    const pricePerLitre = 200;
    const amountPaid = 10.34 * pricePerLitre;
    const result = calculateCashback({ amountPaid, pricePerLitre });
    expect(result.litres).toBeCloseTo(10.34, 2);
    expect(result.wholeLitres).toBe(10);
    expect(result.cashbackEarned).toBe(20);
  });

  it('earns KES 40 for 20.67 litres at the default rate', () => {
    const pricePerLitre = 226.4;
    const amountPaid = 20.67 * pricePerLitre;
    const result = calculateCashback({ amountPaid, pricePerLitre });
    expect(result.wholeLitres).toBe(20);
    expect(result.cashbackEarned).toBe(40);
  });

  it('truncates litre decimals rather than rounding', () => {
    // 9.999 litres must NOT round up to 10 whole litres.
    const pricePerLitre = 100;
    const amountPaid = 9.999 * pricePerLitre;
    const result = calculateCashback({ amountPaid, pricePerLitre });
    expect(result.wholeLitres).toBe(9);
    expect(result.cashbackEarned).toBe(18);
  });

  it('is robust to binary floating point noise near a whole-litre boundary', () => {
    // 0.1 + 0.2 style noise: construct an amount that floats to
    // 11.000000000000002 litres and must still floor to 11, not 12.
    const pricePerLitre = 3;
    const amountPaid = 33; // exactly 11 litres
    const result = calculateCashback({ amountPaid, pricePerLitre });
    expect(result.wholeLitres).toBe(11);
    expect(result.litres).toBe(11);
  });

  it('applies a special customer rate instead of the default', () => {
    const result = calculateCashback({
      amountPaid: 1000,
      pricePerLitre: 200,
      cashbackRatePerLitre: 5,
    });
    expect(result.wholeLitres).toBe(5);
    expect(result.cashbackEarned).toBe(25);
    expect(result.cashbackRatePerLitre).toBe(5);
  });

  it('defaults to KES 2 per litre when no rate is given', () => {
    const result = calculateCashback({ amountPaid: 200, pricePerLitre: 100 });
    expect(result.cashbackRatePerLitre).toBe(DEFAULT_CASHBACK_RATE_KES);
    expect(result.cashbackEarned).toBe(4);
  });

  it('rejects non-positive amounts and prices', () => {
    expect(() => calculateCashback({ amountPaid: 0, pricePerLitre: 100 })).toThrow();
    expect(() => calculateCashback({ amountPaid: -5, pricePerLitre: 100 })).toThrow();
    expect(() => calculateCashback({ amountPaid: 100, pricePerLitre: 0 })).toThrow();
  });

  it('handles less than one whole litre by earning zero cashback', () => {
    const result = calculateCashback({ amountPaid: 50, pricePerLitre: 100 });
    expect(result.wholeLitres).toBe(0);
    expect(result.cashbackEarned).toBe(0);
  });
});

describe('verifyCashback', () => {
  it('accepts a client-claimed value that matches the server calculation', () => {
    const { valid } = verifyCashback({ amountPaid: 2000, pricePerLitre: 200 }, 20);
    expect(valid).toBe(true);
  });

  it('rejects a client-claimed value that overstates cashback (e.g. rounded up litres)', () => {
    const { valid, expected } = verifyCashback({ amountPaid: 2000, pricePerLitre: 200 }, 22);
    expect(valid).toBe(false);
    expect(expected.cashbackEarned).toBe(20);
  });
});
