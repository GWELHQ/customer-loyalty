/**
 * Uppercase, separator-stripped — NFC/RFID tag UIDs are hex strings, but
 * humans (typing a UID into the web admin) and readers/apps (dumping raw
 * bytes) don't agree on how to punctuate them: "F9:45:EF:A2", "F9-45-EF-A2",
 * and "F945EFA2" are all the same tag. Strip everything but letters and
 * digits so any of those forms normalize to one canonical string, then
 * uppercase. Shared by customers (loyalty card) and attendants (staff
 * badge) — same tag format, different Firestore collections, so uniqueness
 * is checked independently per collection rather than in one shared
 * namespace.
 */
export function normalizeNfcTagId(tagId: string): string {
  return tagId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}
