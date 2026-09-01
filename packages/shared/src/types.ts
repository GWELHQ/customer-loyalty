import type {
  CustomerRegistrationStatus,
  DisbursementBatchStatus,
  DisbursementEntryStatus,
  FraudFlagSeverity,
  FraudFlagStatus,
  FraudFlagType,
  ImportRowResult,
  ImportStatus,
  LedgerStatus,
  NotificationType,
  Product,
  ReconciliationStatus,
  SaleApprovalStatus,
  ShiftType,
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
  /** A Role enum value, or a custom role key created via /rbac/roles — not a fixed enum anymore, see RbacService. */
  role: string;
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
  /** Normalized uppercase. Physical RFID/NFC staff badge UID — logs the attendant straight in, no PIN. Unique across attendants, staff-assigned via the admin app. */
  nfcTagId?: string;
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
  /** Normalized uppercase, spaces/dashes stripped, one per vehicle the customer fuels. Compared against OCR results from vehicle-plate-check photos. */
  licensePlateNumbers?: string[];
  /** Normalized uppercase. Physical NFC tag UID, staff-assigned via the admin app, unique across customers. */
  nfcTagId?: string;
  /** Soft-delete marker — set instead of removing the document, so the mobile delta sync (GET /mobile/customers?updatedSince=) sees the deletion via the normal updatedAt bump and can drop its local copy. Absent/undefined means active. */
  deletedAt?: ISODateString | null;
}

export interface ProductPrice extends BaseDoc {
  stationId: string;
  stationNameAtPrice: string;
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
  /** Result of the vehicle-plate photo check performed just before this sale was recorded, if any. Never blocks the sale either way. */
  licensePlateCheck?: {
    plateCheckId: string;
    detectedPlateNumber: string | null;
    matched: boolean;
  };
  /**
   * Undefined = a legacy sale recorded before the approval gate existed —
   * treated as already-approved everywhere (its cashback was credited
   * immediately, the old way). New sales always start at PENDING_APPROVAL;
   * cashback is only credited to the customer once this becomes APPROVED.
   */
  approvalStatus?: SaleApprovalStatus;
  approvalDecidedByUserId?: string;
  approvalDecidedByName?: string;
  approvalDecidedAt?: ISODateString;
  /** Only set when approvalStatus is REJECTED. */
  rejectionReason?: string;
}

export interface SaleApprovalDelegation extends BaseDoc {
  stationId: string;
  stationNameAtDelegation: string;
  delegatorUserId: string;
  delegatorName: string;
  delegateUserId: string;
  delegateName: string;
  startDate: ISODateString;
  endDate: ISODateString;
  revokedAt?: ISODateString;
  revokedByUserId?: string;
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

export type SalesReportGroupBy = 'attendant' | 'station' | 'shift' | 'product';

export interface SalesReportGroup {
  key: string;
  label: string;
  count: number;
  amount: number;
  cashback: number;
}

export interface ShiftRoster extends BaseDoc {
  stationId: string;
  /** The Nairobi calendar day the shift *starts* on — see nairobiShiftBucket. */
  date: ISODateString;
  shift: ShiftType;
  attendantIds: string[];
  recordedByUserId: string;
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
  /** Only populated for entityType 'sale' — true if any fraud flag (open or resolved) is related to this sale. Computed server-side per audit-events list response, not stored. */
  hasFraudFlag?: boolean;
}

export interface VehiclePlateCheck extends BaseDoc {
  customerId: string;
  customerNameAtCheck: string;
  attendantId: string;
  stationId: string;
  /** gs:// path of the captured photo. */
  imageUrl: string;
  /** Best-guess plate text extracted by OCR, normalized (uppercase, no spaces/dashes) — null if nothing plausible was found. */
  detectedPlateNumber: string | null;
  /** False whenever the customer has no licensePlateNumber on file, OCR found nothing, or the two disagree. */
  matched: boolean;
}

export interface FraudFlag extends BaseDoc {
  type: FraudFlagType;
  severity: FraudFlagSeverity;
  status: FraudFlagStatus;
  customerId?: string;
  customerNameAtFlag?: string;
  stationId?: string;
  stationNameAtFlag?: string;
  attendantId?: string;
  attendantNameAtFlag?: string;
  /** Sale ids that triggered/support this flag. */
  relatedSaleIds: string[];
  /** Calendar window the check covered (the scanned day, or the rolling window). */
  periodStart?: ISODateString;
  periodEnd?: ISODateString;
  detectionMode: 'realtime' | 'batch';
  /** Per-check payload, e.g. { baselineAvgLitres, actualLitres, multiplier, sampleSize }. */
  evidence: Record<string, unknown>;
  reviewedByUserId?: string;
  reviewedByName?: string;
  reviewedAt?: ISODateString;
  resolutionNote?: string;
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
