import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Product, type ProductPrice } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import type { StaffPrincipal } from '../common/types/principal';
import { ChangeEventsService } from '../events/change-events.service';

const COLLECTION = 'productPrices';

@Injectable()
export class PricesService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly changeEvents: ChangeEventsService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  /** The price in effect for a product at a given instant (defaults to now). Authoritative for sale calculation. */
  async getCurrentForProduct(product: Product, at: Date = new Date()): Promise<ProductPrice | null> {
    const snap = await this.col()
      .where('product', '==', product)
      .where('effectiveFrom', '<=', at.toISOString())
      .orderBy('effectiveFrom', 'desc')
      .limit(1)
      .get();
    return snap.empty ? null : fromDoc<ProductPrice>(snap.docs[0]!);
  }

  async getCurrent(): Promise<Record<Product, ProductPrice | null>> {
    const [pms, ago] = await Promise.all([
      this.getCurrentForProduct(Product.PMS),
      this.getCurrentForProduct(Product.AGO),
    ]);
    return { [Product.PMS]: pms, [Product.AGO]: ago };
  }

  async history(product?: Product): Promise<ProductPrice[]> {
    let query = this.col().orderBy('effectiveFrom', 'desc') as FirebaseFirestore.Query;
    if (product) query = query.where('product', '==', product);
    const snap = await query.get();
    return snap.docs.map((d) => fromDoc<ProductPrice>(d));
  }

  /**
   * Publishes a new price. A new price never overwrites the old one — sales
   * keep the price that was live when they happened via their own snapshot.
   * The previously-current record for the product is closed off with
   * effectiveTo for a clean audit history.
   */
  async create(
    input: { product: Product; pricePerLitre: number; effectiveFrom: string },
    createdBy: StaffPrincipal,
  ): Promise<ProductPrice> {
    const previous = await this.getCurrentForProduct(input.product, new Date(input.effectiveFrom));
    if (previous && new Date(previous.effectiveFrom) >= new Date(input.effectiveFrom)) {
      throw new BadRequestException(
        'effectiveFrom must be after the currently effective price for this product',
      );
    }

    const now = nowIso();
    const doc: Omit<ProductPrice, 'id'> = {
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
