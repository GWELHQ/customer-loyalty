import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PIN_LOCKOUT_MINUTES, PIN_MAX_FAILED_ATTEMPTS, UserStatus, type Attendant } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { ChangeEventsService } from '../events/change-events.service';

const COLLECTION = 'attendants';

@Injectable()
export class AttendantsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly changeEvents: ChangeEventsService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  async list(stationId?: string): Promise<Attendant[]> {
    let query = this.col().orderBy('fullName') as FirebaseFirestore.Query;
    if (stationId) query = query.where('assignedStationId', '==', stationId);
    const snap = await query.get();
    return snap.docs.map((d) => fromDoc<Attendant>(d));
  }

  async findById(id: string): Promise<Attendant | null> {
    const snap = await this.col().doc(id).get();
    return snap.exists ? fromDoc<Attendant>(snap) : null;
  }

  async findByEmployeeId(employeeId: string): Promise<Attendant | null> {
    const snap = await this.col().where('employeeId', '==', employeeId).limit(1).get();
    return snap.empty ? null : fromDoc<Attendant>(snap.docs[0]!);
  }

  async create(input: {
    fullName: string;
    employeeId: string;
    assignedStationId: string;
    pin: string;
  }): Promise<Attendant> {
    const existing = await this.findByEmployeeId(input.employeeId);
    if (existing) throw new ConflictException('Employee ID already in use');

    const pinHash = await argon2.hash(input.pin, { type: argon2.argon2id });
    const now = nowIso();
    const doc: Omit<Attendant, 'id'> = {
      fullName: input.fullName,
      employeeId: input.employeeId,
      assignedStationId: input.assignedStationId,
      status: UserStatus.ACTIVE,
      pinHash,
      failedPinAttempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.col().add(doc);
    this.changeEvents.emit(COLLECTION);
    return { ...doc, id: ref.id };
  }

  async resetPin(id: string, newPin: string): Promise<void> {
    const attendant = await this.findById(id);
    if (!attendant) throw new NotFoundException('Attendant not found');
    const pinHash = await argon2.hash(newPin, { type: argon2.argon2id });
    await this.col().doc(id).update({
      pinHash,
      failedPinAttempts: 0,
      lockedUntil: null,
      updatedAt: nowIso(),
    });
    this.changeEvents.emit(COLLECTION);
  }

  async setStatus(id: string, status: UserStatus): Promise<Attendant> {
    const attendant = await this.findById(id);
    if (!attendant) throw new NotFoundException('Attendant not found');
    await this.col().doc(id).update({ status, updatedAt: nowIso() });
    this.changeEvents.emit(COLLECTION);
    return (await this.findById(id))!;
  }

  async assignStation(id: string, assignedStationId: string): Promise<Attendant> {
    const attendant = await this.findById(id);
    if (!attendant) throw new NotFoundException('Attendant not found');
    await this.col().doc(id).update({ assignedStationId, updatedAt: nowIso() });
    this.changeEvents.emit(COLLECTION);
    return (await this.findById(id))!;
  }

  /**
   * Verifies employeeId + PIN with lockout after PIN_MAX_FAILED_ATTEMPTS.
   * Never authenticates on PIN alone — employeeId narrows to one account
   * first, matching the "stable identifier plus PIN" requirement.
   */
  async verifyCredentials(employeeId: string, pin: string): Promise<Attendant> {
    const attendant = await this.findByEmployeeId(employeeId);
    if (!attendant) throw new UnauthorizedException('Invalid employee ID or PIN');

    if (attendant.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('This attendant account is inactive');
    }

    if (attendant.lockedUntil && new Date(attendant.lockedUntil) > new Date()) {
      throw new UnauthorizedException(
        `Account temporarily locked after too many failed attempts. Try again after ${attendant.lockedUntil}.`,
      );
    }

    const valid = await argon2.verify(attendant.pinHash, pin);
    if (!valid) {
      await this.registerFailedAttempt(attendant);
      throw new UnauthorizedException('Invalid employee ID or PIN');
    }

    if (attendant.failedPinAttempts > 0) {
      await this.col().doc(attendant.id).update({ failedPinAttempts: 0, lockedUntil: null });
    }
    await this.col().doc(attendant.id).update({ lastLoginAt: nowIso() });

    return attendant;
  }

  private async registerFailedAttempt(attendant: Attendant): Promise<void> {
    const attempts = attendant.failedPinAttempts + 1;
    const update: Record<string, unknown> = { failedPinAttempts: attempts, updatedAt: nowIso() };
    if (attempts >= PIN_MAX_FAILED_ATTEMPTS) {
      update.lockedUntil = new Date(Date.now() + PIN_LOCKOUT_MINUTES * 60_000).toISOString();
    }
    await this.col().doc(attendant.id).update(update);
  }
}
