import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Station } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { ChangeEventsService } from '../events/change-events.service';

const COLLECTION = 'stations';

@Injectable()
export class StationsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly changeEvents: ChangeEventsService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  async list(): Promise<Station[]> {
    const snap = await this.col().orderBy('name').get();
    return snap.docs.map((d) => fromDoc<Station>(d));
  }

  async findById(id: string): Promise<Station | null> {
    const snap = await this.col().doc(id).get();
    return snap.exists ? fromDoc<Station>(snap) : null;
  }

  async create(input: { name: string; code: string; location?: string }): Promise<Station> {
    const dup = await this.col().where('code', '==', input.code).limit(1).get();
    if (!dup.empty) throw new ConflictException('Station code already exists');

    const now = nowIso();
    const doc: Omit<Station, 'id'> = {
      name: input.name,
      code: input.code,
      location: input.location,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.col().add(doc);
    this.changeEvents.emit(COLLECTION);
    return { ...doc, id: ref.id };
  }

  async update(
    id: string,
    input: Partial<Pick<Station, 'name' | 'location' | 'active'>>,
  ): Promise<Station> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundException('Station not found');
    await this.col()
      .doc(id)
      .update({ ...input, updatedAt: nowIso() });
    this.changeEvents.emit(COLLECTION);
    return (await this.findById(id))!;
  }

  /**
   * Hard delete is only safe for a station nothing else points at — a
   * customer's homeStationId, a sale's stationId, an attendant's or
   * station-supervisor's assignedStationId. Any of those existing means
   * something in the system still expects this station to resolve
   * (Android login, reconciliation, reports); deactivating (via `update`)
   * is the right move there instead of destroying the record.
   */
  async delete(id: string): Promise<Station> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundException('Station not found');

    const blockers: string[] = [];
    const checks: [string, FirebaseFirestore.Query][] = [
      ['customers', this.firestore.collection('customers').where('homeStationId', '==', id)],
      ['sales', this.firestore.collection('sales').where('stationId', '==', id)],
      ['attendants', this.firestore.collection('attendants').where('assignedStationId', '==', id)],
      ['users', this.firestore.collection('users').where('assignedStationId', '==', id)],
    ];
    const results = await Promise.all(checks.map(([, query]) => query.limit(1).get()));
    results.forEach((snap, i) => {
      if (!snap.empty) blockers.push(checks[i]![0]);
    });

    if (blockers.length > 0) {
      throw new ConflictException(
        `Cannot delete "${existing.name}" — it still has ${blockers.join(', ')} referencing it. Deactivate it instead.`,
      );
    }

    await this.col().doc(id).delete();
    this.changeEvents.emit(COLLECTION);
    return existing;
  }
}
