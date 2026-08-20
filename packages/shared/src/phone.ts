/**
 * Normalizes Kenyan phone numbers to E.164 (+254XXXXXXXXX) so that phone
 * number is a reliable, deduplicatable primary identity for customers
 * across every input channel (admin manual entry, Excel import, Android).
 *
 * Accepts: 0712345678, 712345678, 254712345678, +254712345678,
 * with arbitrary spaces/dashes/parentheses.
 */
export function normalizePhoneNumber(raw: string): string {
  if (!raw) throw new PhoneNormalizationError(raw, 'Phone number is required');

  const digits = raw.replace(/[^\d+]/g, '');
  const withoutPlus = digits.startsWith('+') ? digits.slice(1) : digits;

  let national: string;
  if (withoutPlus.startsWith('254')) {
    national = withoutPlus.slice(3);
  } else if (withoutPlus.startsWith('0')) {
    national = withoutPlus.slice(1);
  } else {
    national = withoutPlus;
  }

  // Kenyan mobile numbers: 9 digits after the leading 0/254, starting 7 or 1.
  if (!/^[71]\d{8}$/.test(national)) {
    throw new PhoneNormalizationError(raw, 'Not a valid Kenyan mobile number');
  }

  return `+254${national}`;
}

export function isValidPhoneNumber(raw: string): boolean {
  try {
    normalizePhoneNumber(raw);
    return true;
  } catch {
    return false;
  }
}

export class PhoneNormalizationError extends Error {
  constructor(
    public readonly raw: string,
    message: string,
  ) {
    super(message);
    this.name = 'PhoneNormalizationError';
  }
}
