import { Injectable } from '@nestjs/common';
import { ShiftType, type ShiftRoster } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { nairobiShiftBucket } from '../common/time/nairobi';
import type { StaffPrincipal } from '../common/types/principal';
import { ChangeEventsService } from '../events/change-events.service';

const COLLECTION = 'shiftRosters';

function rosterKey(stationId: string, shift: ShiftType, date: string): string {
  return `${stationId}__${shift}__${date.slice(0, 10)}`;
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly changeEvents: ChangeEventsService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  async recordRoster(
    input: { stationId: string; shift: ShiftType; date: string; attendantIds: string[] },
    actor: StaffPrincipal,
  ): Promise<ShiftRoster> {
    const id = rosterKey(input.stationId, input.shift, input.date);
    const ref = this.col().doc(id);
    const now = nowIso();

    return this.firestore.instance
      .runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const doc: Omit<ShiftRoster, 'id'> = {
          stationId: input.stationId,
          date: input.date.slice(0, 10),
          shift: input.shift,
          attendantIds: input.attendantIds,
          recordedByUserId: actor.userId,
          createdAt: snap.exists ? (snap.data()?.createdAt as string) : now,
          updatedAt: now,
        };
        tx.set(ref, doc, { merge: true });
        return { ...doc, id };
      })
      .then((result) => {
        this.changeEvents.emit(COLLECTION);
        return result;
      });
  }

  async listRosters(filters: { stationId?: string; date?: string }): Promise<ShiftRoster[]> {
    let query = this.col().orderBy('date', 'desc') as FirebaseFirestore.Query;
    if (filters.stationId) query = query.where('stationId', '==', filters.stationId);
    if (filters.date) query = query.where('date', '==', filters.date.slice(0, 10));
    const snap = await query.limit(200).get();
    return snap.docs.map((d) => fromDoc<ShiftRoster>(d));
  }

  /**
   * Looks up the roster covering the shift a sale's timestamp falls in —
   * used only by fraud detection. Returns null when no roster was ever
   * recorded for that station/date/shift (the caller treats that as
   * "nothing to check against", not a violation).
   */
  async findRosterForSale(stationId: string, saleDateIso: string): Promise<ShiftRoster | null> {
    const { date, shift } = nairobiShiftBucket(saleDateIso);
    const snap = await this.col().doc(rosterKey(stationId, shift as ShiftType, date)).get();
    return snap.exists ? fromDoc<ShiftRoster>(snap) : null;
  }
}
