import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Station } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';

const COLLECTION = 'stations';

@Injectable()
export class StationsService {
  constructor(private readonly firestore: FirestoreService) {}

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
    return (await this.findById(id))!;
  }
}
