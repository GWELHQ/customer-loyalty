import type {
  CustomerRegistrationStatus,
  DisbursementBatchStatus,
  DisbursementEntryStatus,
  ImportRowResult,
  ImportStatus,
  LedgerStatus,
  NotificationType,
  Product,
  ReconciliationStatus,
  Role,
  SmsStatus,
  SpecialRateStatus,
  SyncRecordResult,
  UserStatus,
} from './enums.js';

/** ISO-8601 string. Firestore Timestamps are converted to/from this at the API boundary. */
export type ISODateString = string;

export interface BaseDoc {
  id: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface Station extends BaseDoc {
  name: string;
  code: string;
  location?: string;
  active: boolean;
}

export interface User extends BaseDoc {
  fullName: string;
  email: string;
  role: Role;
  status: UserStatus;
  /** Required and singular for station_supervisor; must be undefined for every other role. */
  assignedStationId?: string;
  microsoftOid?: string;
  lastLoginAt?: ISODateString;
}

export interface Attendant extends BaseDoc {
  fullName: string;
  employeeId: string;
  assignedStationId: string;
  status: UserStatus;
  pinHash: string;
  failedPinAttempts: number;
  lockedUntil?: ISODateString;
  lastLoginAt?: ISODateString;
}

export interface Customer extends BaseDoc {
  fullName: string;
  phoneNumber: string;
  homeStationId?: string;
  specialRateId?: string;
  specialRateKesPerLitre?: number;
  specialRateEffectiveFrom?: ISODateString;
  specialRateEffectiveTo?: ISODateString;
  totalCashbackEarned: number;
  source: 'manual' | 'import' | 'android';
  lastActivityAt?: ISODateString;
  inactivityNoticeSentAt?: ISODateString;
}

export interface ProductPrice extends BaseDoc {
  product: Product;
  pricePerLitre: number;
  effectiveFrom: ISODateString;
  effectiveTo?: ISODateString;
  createdByUserId: string;
  createdByName: string;
}

export interface PriceReminderSetting extends BaseDoc {
  enabled: boolean;
  dayOfMonth: number;
  hourOfDay: number;
  timezone: string;
  recipientEmails: string[];
  nextReminderAt: ISODateString;
  lastSentAt?: ISODateString;
}

export interface DisbursementSettings extends BaseDoc {
  /** Ledger entries with totalCashback below this amount are excluded from
   *  the month's disbursement batch and carried forward to next month. */
  minDisbursementAmount: number;
}

export interface CustomerInactivitySettings extends BaseDoc {
  /** Days of no activity before a customer gets an SMS reset notice. */
  noticeAfterDays: number;
  /** Additional days of continued inactivity after the notice before the reset actually happens. */
  resetAfterAdditionalDays: number;
}

export interface SaleSnapshot {
  litres: number;
  wholeLitres: number;
  pricePerLitre: number;
  cashbackRatePerLitre: number;
  cashbackEarned: number;
}

export interface Sale extends BaseDoc {
  customerId: string;
  customerPhoneAtSale: string;
  product: Product;
  amountPaid: number;
  stationId: string;
  stationNameAtSale: string;
  attendantId: string;
  attendantNameAtSale: string;
  saleDate: ISODateString;
  snapshot: SaleSnapshot;
  specialRateIdAtSale?: string;
  idempotencyKey: string;
  clientLocalId?: string;
  source: 'android' | 'admin_manual';
  smsStatus: SmsStatus;
}

export interface SmsDelivery extends BaseDoc {
  /** Unset for SMS not tied to a sale, e.g. a customer inactivity notice. */
  saleId?: string;
  customerPhone: string;
  message: string;
  status: SmsStatus;
  providerName: string;
  providerResponse?: string;
  retryCount: number;
  errorReason?: string;
  sentAt?: ISODateString;
}

export interface SpecialRateRequest extends BaseDoc {
  customerId: string;
  proposedKesPerLitre: number;
  effectiveFrom: ISODateString;
  effectiveTo?: ISODateString;
  reason: string;
  requestedByUserId: string;
  requestedByName: string;
  status: SpecialRateStatus;
  decisionNote?: string;
  decidedByUserId?: string;
  decidedByName?: string;
  decidedAt?: ISODateString;
  revokedByUserId?: string;
  revokedByName?: string;
  revokedAt?: ISODateString;
}

/**
 * A brand-new customer + the sale that happened at registration time,
 * submitted by an attendant via the mobile app. Neither the Customer nor
 * the Sale exists in their real collections until a Station Supervisor /
 * RTSM / Admin approves this request — see CustomerRegistrationRequestsService.
 */
export interface CustomerRegistrationRequest extends BaseDoc {
  stationId: string;
  stationNameAtRequest: string;
  attendantId: string;
  attendantNameAtRequest: string;
  customerFullName: string;
  customerPhoneNumber: string;
  product: Product;
  amountPaid: number;
  saleDate: ISODateString;
  /** Preview only — the authoritative snapshot is recalculated at approval time using this same saleDate. */
  snapshot: SaleSnapshot;
  idempotencyKey: string;
  status: CustomerRegistrationStatus;
  decisionNote?: string;
  decidedByUserId?: string;
  decidedByName?: string;
  decidedAt?: ISODateString;
  customerId?: string;
  saleId?: string;
}

export interface ReconciliationDaily extends BaseDoc {
  stationId: string;
  product: Product;
  date: ISODateString;
  totalSales: number;
  loyaltySales: number;
  percentage: number;
  headroom: number;
  status: ReconciliationStatus;
  ingestedByUserId: string;
  flaggedSaleIds: string[];
}

export interface MonthlyCashbackLedgerEntry {
  customerId: string;
  customerName: string;
  customerPhone: string;
  eligibleSalesCount: number;
  totalCashback: number;
  /** Amount carried forward from a prior month's below-threshold disbursement exclusion. */
  carriedForwardAmount?: number;
  carriedForwardFromMonth?: string;
  /** Running total already paid out across all of this month's disbursement batches. totalCashback - disbursedAmount = still owed. */
  disbursedAmount?: number;
}

export interface MonthlyCashbackLedger extends BaseDoc {
  month: string; // YYYY-MM
  status: LedgerStatus;
  entries: MonthlyCashbackLedgerEntry[];
  totalCashback: number;
  submittedByUserId?: string;
  submittedByName?: string;
  submittedAt?: ISODateString;
  approvedByUserId?: string;
  approvedByName?: string;
  approvedAt?: ISODateString;
  rejectedByUserId?: string;
  rejectedByName?: string;
  rejectedAt?: ISODateString;
  rejectionReason?: string;
}

export interface DisbursementEntry {
  customerId: string;
  customerName: string;
  customerPhone: string;
  amount: number;
  status: DisbursementEntryStatus;
  reference?: string;
  failureReason?: string;
  holdReason?: string;
}

export interface DisbursementBatch extends BaseDoc {
  month: string;
  ledgerId: string;
  status: DisbursementBatchStatus;
  entries: DisbursementEntry[];
  totalAmount: number;
  createdByUserId: string;
  holdReason?: string;
  confirmedByUserId?: string;
  confirmedAt?: ISODateString;
  completedAt?: ISODateString;
}

export interface ImportJob extends BaseDoc {
  fileName: string;
  gcsFilePath: string;
  errorReportGcsPath?: string;
  status: ImportStatus;
  totalRows: number;
  createdCount: number;
  duplicateCount: number;
  rejectedCount: number;
  uploadedByUserId: string;
  uploadedByName: string;
  columnMapping: Record<string, string>;
  allHeaders: string[];
  homeStationId: string;
  homeStationName: string;
}

export interface ImportRow {
  rowNumber: number;
  rawData: Record<string, string>;
  result: ImportRowResult;
  customerId?: string;
  problem?: string;
}

export interface Notification extends BaseDoc {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  linkPath?: string;
}

export interface AuditEvent extends BaseDoc {
  actorUserId?: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  /** Human-readable name for the affected record (e.g. a customer's or station's name) — the UI shows this instead of the raw Firestore document ID. */
  entityLabel?: string;
  metadata?: Record<string, unknown>;
}

export interface SyncOperation extends BaseDoc {
  attendantId: string;
  clientLocalId: string;
  idempotencyKey: string;
  result: SyncRecordResult;
  saleId?: string;
  errorReason?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  nextCursor: string | null;
}

export interface ImportedCollection {
  users: User[];
  stations: Station[];
  customers: Customer[];
  sales: Sale[];
}
