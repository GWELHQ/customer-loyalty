import { z } from 'zod';
import { Product } from './enums.js';
import { isValidPhoneNumber } from './phone.js';

export const phoneSchema = z
  .string()
  .refine(isValidPhoneNumber, { message: 'Not a valid Kenyan mobile number' });

export const productSchema = z.nativeEnum(Product);

export const createSaleSchema = z.object({
  customerPhone: phoneSchema,
  product: productSchema,
  amountPaid: z.number().positive(),
  stationId: z.string().min(1),
  saleDate: z.string().datetime().optional(),
  idempotencyKey: z.string().uuid(),
  clientLocalId: z.string().min(1).optional(),
});
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export const bulkSyncSaleSchema = createSaleSchema.extend({
  clientLocalId: z.string().min(1),
  claimedCashbackEarned: z.number().nonnegative().optional(),
  claimedPricePerLitre: z.number().positive().optional(),
});
export type BulkSyncSaleInput = z.infer<typeof bulkSyncSaleSchema>;

export const bulkSyncRequestSchema = z.object({
  sales: z.array(bulkSyncSaleSchema).min(1).max(500),
});
export type BulkSyncRequest = z.infer<typeof bulkSyncRequestSchema>;

export const createCustomerSchema = z.object({
  fullName: z.string().min(1).max(200),
  phoneNumber: phoneSchema,
  homeStationId: z.string().min(1).optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const createSpecialRateRequestSchema = z.object({
  customerId: z.string().min(1),
  proposedKesPerLitre: z.number().positive(),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().optional(),
  reason: z.string().min(5).max(1000),
});
export type CreateSpecialRateRequestInput = z.infer<typeof createSpecialRateRequestSchema>;

export const decideSpecialRateRequestSchema = z.object({
  decisionNote: z.string().max(1000).optional(),
});
export type DecideSpecialRateRequestInput = z.infer<typeof decideSpecialRateRequestSchema>;

export const createProductPriceSchema = z.object({
  product: productSchema,
  pricePerLitre: z.number().positive(),
  effectiveFrom: z.string().datetime(),
});
export type CreateProductPriceInput = z.infer<typeof createProductPriceSchema>;

export const attendantLoginSchema = z.object({
  employeeId: z.string().min(1),
  pin: z.string().regex(/^\d{4,6}$/),
});
export type AttendantLoginInput = z.infer<typeof attendantLoginSchema>;

export const dailyTotalsIngestSchema = z.object({
  stationId: z.string().min(1),
  product: productSchema,
  date: z.string().datetime(),
  totalSales: z.number().nonnegative(),
});
export type DailyTotalsIngestInput = z.infer<typeof dailyTotalsIngestSchema>;
