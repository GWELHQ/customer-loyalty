import { Timestamp } from 'firebase-admin/firestore';
import type { DocumentSnapshot, QueryDocumentSnapshot } from 'firebase-admin/firestore';

/**
 * Converts a Firestore document into a typed domain object, mapping
 * Firestore Timestamp fields to ISO-8601 strings so every layer above the
 * repository deals in plain JSON-serializable values.
 */
export function fromDoc<T extends { id: string }>(
  snap: DocumentSnapshot | QueryDocumentSnapshot,
): T {
  const data = snap.data() ?? {};
  return { ...(deepConvertTimestamps(data) as Record<string, unknown>), id: snap.id } as T;
}

function deepConvertTimestamps(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(deepConvertTimestamps);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        deepConvertTimestamps(v),
      ]),
    );
  }
  return value;
}

export function nowIso(): string {
  return new Date().toISOString();
}
