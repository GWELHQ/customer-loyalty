import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Product, type ProductPrice, type Station } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import type { StaffPrincipal } from '../common/types/principal';
import { ChangeEventsService } from '../events/change-events.service';
import { StationsService } from '../stations/stations.service';

const COLLECTION = 'productPrices';

@Injectable()
export class PricesService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly changeEvents: ChangeEventsService,
    private readonly stations: StationsService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  /** The price in effect for a product at a station at a given instant (defaults to now). Authoritative for sale calculation. */
  async getCurrentForProduct(stationId: string, product: Product, at: Date = new Date()): Promise<ProductPrice | null> {
    const snap = await this.col()
      .where('stationId', '==', stationId)
      .where('product', '==', product)
      .where('effectiveFrom', '<=', at.toISOString())
      .orderBy('effectiveFrom', 'desc')
      .limit(1)
      .get();
    return snap.empty ? null : fromDoc<ProductPrice>(snap.docs[0]!);
  }

  async getCurrent(stationId: string): Promise<Record<Product, ProductPrice | null>> {
    const [pms, ago] = await Promise.all([
      this.getCurrentForProduct(stationId, Product.PMS),
      this.getCurrentForProduct(stationId, Product.AGO),
    ]);
    return { [Product.PMS]: pms, [Product.AGO]: ago };
  }

  /**
   * Every active station's current prices — powers the admin cross-station
   * "missing price" check and the price-reminder job. Cheap at current
   * scale (a handful of stations × 2 products).
   */
  async getCurrentForAllStations(): Promise<Array<{ station: Station; prices: Record<Product, ProductPrice | null> }>> {
    const stations = (await this.stations.list()).filter((s) => s.active);
    return Promise.all(stations.map(async (station) => ({ station, prices: await this.getCurrent(station.id) })));
  }

  async history(product?: Product, stationId?: string): Promise<ProductPrice[]> {
    let query = this.col().orderBy('effectiveFrom', 'desc') as FirebaseFirestore.Query;
    if (stationId) query = query.where('stationId', '==', stationId);
    if (product) query = query.where('product', '==', product);
    const snap = await query.get();
    return snap.docs.map((d) => fromDoc<ProductPrice>(d));
  }

  /**
   * Publishes a new price for a station. A new price never overwrites the
   * old one — sales keep the price that was live when they happened via
   * their own snapshot. The previously-current record for that
   * station+product is closed off with effectiveTo for a clean audit
   * history.
   */
  async create(
    input: { stationId: string; product: Product; pricePerLitre: number; effectiveFrom: string },
    createdBy: StaffPrincipal,
  ): Promise<ProductPrice> {
    const station = await this.stations.findById(input.stationId);
    if (!station) throw new NotFoundException('Station not found');

    const previous = await this.getCurrentForProduct(input.stationId, input.product, new Date(input.effectiveFrom));
    if (previous && new Date(previous.effectiveFrom) >= new Date(input.effectiveFrom)) {
      throw new BadRequestException(
        'effectiveFrom must be after the currently effective price for this product at this station',
      );
    }

    const now = nowIso();
    const doc: Omit<ProductPrice, 'id'> = {
      stationId: input.stationId,
      stationNameAtPrice: station.name,
      product: input.product,
      pricePerLitre: input.pricePerLitre,
      effectiveFrom: input.effectiveFrom,
      createdByUserId: createdBy.userId,
      createdByName: createdBy.fullName,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await this.firestore.instance.runTransaction(async (tx) => {
      const newRef = this.col().doc();
      if (previous) {
        tx.update(this.col().doc(previous.id), {
          effectiveTo: input.effectiveFrom,
          updatedAt: now,
        });
      }
      tx.set(newRef, doc);
      return newRef;
    });

    this.changeEvents.emit(COLLECTION);
    return { ...doc, id: ref.id };
  }

  async findById(id: string): Promise<ProductPrice> {
    const snap = await this.col().doc(id).get();
    if (!snap.exists) throw new NotFoundException('Price not found');
    return fromDoc<ProductPrice>(snap);
  }
}
