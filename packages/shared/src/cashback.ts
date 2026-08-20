/**
 * Core cashback calculation. This is the single source of truth for turning
 * an amount paid at the pump into whole litres and a cashback amount — used
 * server-side (authoritative) and mirrored client-side only for preview UI.
 *
 * litres = amountPaid / pricePerLitre
 * wholeLitres = floor(litres)
 * cashback = wholeLitres * cashbackRatePerLitre
 */

export const DEFAULT_CASHBACK_RATE_KES = 2;

/** Number of decimal places money and price-per-litre values are stored/compared at. */
const DECIMALS = 2;

export interface CashbackCalculationInput {
  amountPaid: number;
  pricePerLitre: number;
  /** KES earned per whole litre. Defaults to DEFAULT_CASHBACK_RATE_KES. */
  cashbackRatePerLitre?: number;
}

export interface CashbackCalculationResult {
  litres: number;
  wholeLitres: number;
  pricePerLitre: number;
  cashbackRatePerLitre: number;
  cashbackEarned: number;
}

/**
 * amountPaid and pricePerLitre are decimals with at most 2 places, but
 * their quotient (litres) is not — it can legitimately need many decimal
 * places (e.g. 9.999 must floor to 9, not 10). A plain Math.floor is only
 * wrong when binary floating-point division lands a fraction of a cent
 * below a whole-litre boundary that should be exactly on it (e.g.
 * 33 / 3 computing as 10.999999999999998 instead of 11). Nudging by a
 * tiny epsilon before flooring fixes that specific case without rounding
 * away real sub-cent-of-a-litre precision the way a full round-to-cents
 * step would.
 */
const FLOOR_EPSILON = 1e-9;

export function calculateCashback(input: CashbackCalculationInput): CashbackCalculationResult {
  const { amountPaid, pricePerLitre } = input;
  const cashbackRatePerLitre = input.cashbackRatePerLitre ?? DEFAULT_CASHBACK_RATE_KES;

  if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
    throw new Error('amountPaid must be a positive finite number');
  }
  if (!Number.isFinite(pricePerLitre) || pricePerLitre <= 0) {
    throw new Error('pricePerLitre must be a positive finite number');
  }
  if (!Number.isFinite(cashbackRatePerLitre) || cashbackRatePerLitre < 0) {
    throw new Error('cashbackRatePerLitre must be a non-negative finite number');
  }

  // litres computed at full precision for display/audit, but only the
  // truncated whole-litre count feeds the cashback amount.
  const litres = amountPaid / pricePerLitre;
  const wholeLitres = Math.floor(litres + FLOOR_EPSILON);
  const cashbackEarned = wholeLitres * cashbackRatePerLitre;

  return {
    litres: roundTo(litres, DECIMALS),
    wholeLitres,
    pricePerLitre,
    cashbackRatePerLitre,
    cashbackEarned: roundTo(cashbackEarned, DECIMALS),
  };
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Re-verifies a client-submitted cashback figure (e.g. from an offline
 * Android sync payload) against the authoritative server-side calculation.
 * Never trust the client value alone.
 */
export function verifyCashback(
  input: CashbackCalculationInput,
  claimedCashbackEarned: number,
): { valid: boolean; expected: CashbackCalculationResult } {
  const expected = calculateCashback(input);
  return {
    valid: Math.abs(expected.cashbackEarned - claimedCashbackEarned) < 0.005,
    expected,
  };
}
