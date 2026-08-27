/** Uppercase, trimmed — NFC/RFID tag UIDs are typically hex strings read verbatim off the tag. Shared by customers (loyalty card) and attendants (staff badge) — same tag format, different Firestore collections, so uniqueness is checked independently per collection rather than in one shared namespace. */
export function normalizeNfcTagId(tagId: string): string {
  return tagId.trim().toUpperCase();
}
