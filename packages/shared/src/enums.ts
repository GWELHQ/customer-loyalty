export enum Role {
  ADMIN = 'admin',
  CHAIRMAN = 'chairman',
  FINANCE = 'finance',
  RTSM = 'rtsm',
  STATION_SUPERVISOR = 'station_supervisor',
  ATTENDANT = 'attendant',
  /** Read-only view of everything the Chairman sees — cannot approve special rates or change anything. */
  EXEC_VIEWER = 'exec_viewer',
}

/** Roles that authenticate via Microsoft Entra ID. Attendants use PIN auth instead. */
export const MICROSOFT_AUTH_ROLES: readonly Role[] = [
  Role.ADMIN,
  Role.CHAIRMAN,
  Role.FINANCE,
  Role.RTSM,
  Role.STATION_SUPERVISOR,
  Role.EXEC_VIEWER,
];

export enum Product {
  PMS = 'PMS',
  AGO = 'AGO',
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum SmsStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
}

export enum SpecialRateStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum CustomerRegistrationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum LedgerStatus {
  OPEN_ACCRUING = 'open_accruing',
  READY_FOR_REVIEW = 'ready_for_review',
  SUBMITTED_FOR_APPROVAL = 'submitted_for_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  DISBURSEMENT_IN_PROGRESS = 'disbursement_in_progress',
  DISBURSED = 'disbursed',
  FAILED = 'failed',
  HELD = 'held',
}

export enum DisbursementBatchStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  HELD = 'held',
}

export enum DisbursementEntryStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  HELD = 'held',
}

export enum ReconciliationStatus {
  PENDING = 'pending',
  HEALTHY = 'healthy',
  NEAR_LIMIT = 'near_limit',
  EXCEEDED = 'exceeded',
  NEEDS_REVIEW = 'needs_review',
}

export enum ImportStatus {
  UPLOADED = 'uploaded',
  MAPPED = 'mapped',
  PREVIEWED = 'previewed',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum ImportRowResult {
  CREATED = 'created',
  DUPLICATE_SKIPPED = 'duplicate_skipped',
  DUPLICATE_MERGED = 'duplicate_merged',
  REJECTED = 'rejected',
}

export enum SyncRecordResult {
  ACCEPTED = 'accepted',
  ALREADY_PROCESSED = 'already_processed',
  REJECTED = 'rejected',
  CONFLICT = 'conflict',
  NEEDS_REVIEW = 'needs_review',
}

export enum NotificationType {
  PRICE_REMINDER = 'price_reminder',
  SPECIAL_RATE_REQUEST = 'special_rate_request',
  SPECIAL_RATE_DECISION = 'special_rate_decision',
  CUSTOMER_REGISTRATION_REQUEST = 'customer_registration_request',
  CUSTOMER_REGISTRATION_DECISION = 'customer_registration_decision',
  IMPORT_COMPLETE = 'import_complete',
  RECONCILIATION_ALERT = 'reconciliation_alert',
  LEDGER_STATE_CHANGE = 'ledger_state_change',
  DISBURSEMENT_STATE_CHANGE = 'disbursement_state_change',
  SMS_FAILURE = 'sms_failure',
}
