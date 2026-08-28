/**
 * Temporary, code-level on/off switches for features that are fully
 * implemented but currently turned off — flip back to true to re-enable,
 * no other changes needed. Not env-driven: these are meant to be toggled
 * by redeploying, not per-environment.
 */
export const FEATURE_FLAGS = {
  customerRfidScanning: false,
  attendantNfcLogin: false,
  licensePlateScanning: false,
  salesApprovals: false,
} as const;
