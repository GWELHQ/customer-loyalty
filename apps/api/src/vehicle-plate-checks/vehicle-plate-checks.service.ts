import { Injectable, NotFoundException } from '@nestjs/common';
import type { VehiclePlateCheck } from '@loyalty/shared';
import { CustomersService, normalizeLicensePlate } from '../customers/customers.service';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { StorageService } from '../common/storage/storage.service';
import type { AttendantPrincipal } from '../common/types/principal';
import { VisionOcrService } from './vision-ocr.service';

const COLLECTION = 'vehiclePlateChecks';

@Injectable()
export class VehiclePlateChecksService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly customers: CustomersService,
    private readonly storage: StorageService,
    private readonly vision: VisionOcrService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  async findById(id: string): Promise<VehiclePlateCheck> {
    const snap = await this.col().doc(id).get();
    if (!snap.exists) throw new NotFoundException('Vehicle plate check not found');
    return fromDoc<VehiclePlateCheck>(snap);
  }

  async create(
    customerId: string,
    file: { originalname: string; buffer: Buffer; mimetype: string },
    actor: AttendantPrincipal,
  ): Promise<VehiclePlateCheck> {
    const customer = await this.customers.findById(customerId);

    const [imageUrl, detectedPlateNumber] = await Promise.all([
      this.storage.uploadBuffer('vehicle-plate-checks', file.originalname, file.buffer, file.mimetype),
      this.vision.detectLicensePlate(file.buffer),
    ]);

    // Plates are already normalized at write time; re-normalizing here is defensive, not load-bearing.
    const matched =
      detectedPlateNumber != null &&
      (customer.licensePlateNumbers ?? []).some((plate) => normalizeLicensePlate(plate) === detectedPlateNumber);

    const now = nowIso();
    const doc: Omit<VehiclePlateCheck, 'id'> = {
      customerId: customer.id,
      customerNameAtCheck: customer.fullName,
      attendantId: actor.attendantId,
      stationId: actor.assignedStationId,
      imageUrl,
      detectedPlateNumber,
      matched,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.col().add(doc);
    return { ...doc, id: ref.id };
  }
}
