import type {
  Attendant,
  AttendantLoginInput,
  AuditEvent,
  Customer,
  CustomerInactivitySettings,
  CustomerRegistrationRequest,
  DisbursementBatch,
  DisbursementSettings,
  FraudFlag,
  FraudFlagStatus,
  FraudFlagType,
  ImportJob,
  ImportRow,
  MonthlyCashbackLedger,
  Notification,
  PaginatedResult,
  Permission,
  PriceReminderSetting,
  Product,
  ProductPrice,
  ReconciliationDaily,
  Role,
  RoleDefinition,
  Sale,
  SaleApprovalDelegation,
  SalesReportGroup,
  SalesReportGroupBy,
  ShiftRoster,
  ShiftType,
  SmsDelivery,
  SpecialRateRequest,
  Station,
  User,
  UserStatus,
  VehiclePlateCheck,
} from '@loyalty/shared';
import { ApiError, HttpClient, toQueryString, type ApiClientOptions } from './http.js';

export { ApiError };
export type { ApiClientOptions };

export interface StaffSessionResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    kind: 'staff';
    userId: string;
    email: string;
    fullName: string;
    role: string;
    permissions: Permission[];
    assignedStationId?: string;
    status: UserStatus;
  };
}

export interface AttendantSessionResponse {
  accessToken: string;
  attendant: {
    kind: 'attendant';
    attendantId: string;
    employeeId: string;
    fullName: string;
    role: Role.ATTENDANT;
    assignedStationId: string;
  };
}

export class LoyaltyApiClient {
  private readonly http: HttpClient;

  constructor(options: ApiClientOptions) {
    this.http = new HttpClient(options);
  }

  auth = {
    microsoftLoginConfig: () =>
      this.http.get<{ tenantId: string; clientId: string; redirectUri: string; authority: string; scopes: string[] }>(
        '/auth/microsoft/login',
      ),
    microsoftCallback: (idToken: string) =>
      this.http.post<StaffSessionResponse>('/auth/microsoft/callback', { idToken }),
    refresh: (refreshToken: string) => this.http.post<StaffSessionResponse>('/auth/refresh', { refreshToken }),
    attendantLogin: (input: AttendantLoginInput) =>
      this.http.post<AttendantSessionResponse>('/auth/attendant/login', input),
    logout: () => this.http.post<void>('/auth/logout'),
    me: () => this.http.get<StaffSessionResponse['user'] | AttendantSessionResponse['attendant']>('/auth/me'),
  };

  users = {
    list: () => this.http.get<User[]>('/users'),
    get: (id: string) => this.http.get<User>(`/users/${id}`),
    create: (input: { fullName: string; email: string; role: string; assignedStationId?: string }) =>
      this.http.post<User>('/users', input),
    update: (id: string, input: Partial<{ fullName: string; role: string; assignedStationId: string }>) =>
      this.http.patch<User>(`/users/${id}`, input),
    setStatus: (id: string, status: 'active' | 'inactive') =>
      this.http.patch<User>(`/users/${id}/status`, { status }),
  };

  rbac = {
    listRoles: () => this.http.get<RoleDefinition[]>('/rbac/roles'),
    getRole: (key: string) => this.http.get<RoleDefinition>(`/rbac/roles/${key}`),
    listPermissions: () => this.http.get<Permission[]>('/rbac/permissions'),
    createRole: (input: { key: string; displayName: string; description: string; permissions: Permission[] }) =>
      this.http.post<RoleDefinition>('/rbac/roles', input),
    updateRole: (key: string, input: Partial<{ displayName: string; description: string; permissions: Permission[] }>) =>
      this.http.patch<RoleDefinition>(`/rbac/roles/${key}`, input),
    deleteRole: (key: string) => this.http.delete<{ success: boolean }>(`/rbac/roles/${key}`),
  };

  attendants = {
    list: (stationId?: string) => this.http.get<Attendant[]>(`/attendants${toQueryString({ stationId })}`),
    create: (input: { fullName: string; employeeId: string; assignedStationId: string; pin: string }) =>
      this.http.post<Attendant>('/attendants', input),
    resetPin: (id: string, newPin: string) => this.http.post<{ success: boolean }>(`/attendants/${id}/reset-pin`, { newPin }),
    setStatus: (id: string, status: 'active' | 'inactive') => this.http.patch<Attendant>(`/attendants/${id}/status`, { status }),
    assignStation: (id: string, stationId: string) => this.http.patch<Attendant>(`/attendants/${id}/station`, { stationId }),
    update: (id: string, input: Partial<{ fullName: string; employeeId: string; nfcTagId: string }>) =>
      this.http.patch<Attendant>(`/attendants/${id}`, input),
    delete: (id: string) => this.http.delete<{ success: boolean }>(`/attendants/${id}`),
  };

  stations = {
    list: () => this.http.get<Station[]>('/stations'),
    get: (id: string) => this.http.get<Station>(`/stations/${id}`),
    create: (input: { name: string; code: string; location?: string }) => this.http.post<Station>('/stations', input),
    update: (id: string, input: Partial<{ name: string; location: string; active: boolean }>) =>
      this.http.patch<Station>(`/stations/${id}`, input),
    delete: (id: string) => this.http.delete<{ success: boolean }>(`/stations/${id}`),
  };

  customers = {
    list: (params: { page?: number; pageSize?: number; name?: string; stationId?: string } = {}) =>
      this.http.get<PaginatedResult<Customer>>(`/customers${toQueryString(params)}`),
    search: (phone: string) => this.http.get<Customer[]>(`/customers/search${toQueryString({ phone })}`),
    get: (id: string) => this.http.get<Customer>(`/customers/${id}`),
    create: (input: {
      fullName: string;
      phoneNumber: string;
      homeStationId?: string;
      licensePlateNumbers?: string[];
      nfcTagId?: string;
    }) => this.http.post<Customer>('/customers', input),
    update: (
      id: string,
      input: Partial<{ fullName: string; homeStationId: string; licensePlateNumbers: string[]; nfcTagId: string }>,
    ) => this.http.patch<Customer>(`/customers/${id}`, input),
    delete: (id: string) => this.http.delete<{ success: boolean }>(`/customers/${id}`),
    uploadImport: (file: File, homeStationId: string) => {
      const form = new FormData();
      form.append('file', file);
      form.append('homeStationId', homeStationId);
      return this.http.post<ImportJob>('/customers/imports', form, { isFormData: true });
    },
    getImport: (id: string) => this.http.get<ImportJob>(`/customers/imports/${id}`),
    getImportResults: (id: string) => this.http.get<ImportRow[]>(`/customers/imports/${id}/results`),
    remapImport: (id: string, columnMapping: Record<string, string>) =>
      this.http.post<ImportJob>(`/customers/imports/${id}/remap`, { columnMapping }),
    confirmImport: (id: string, duplicateDecisions?: Record<string, 'skip' | 'merge'>) =>
      this.http.post<ImportJob>(`/customers/imports/${id}/confirm`, { duplicateDecisions }),
  };

  prices = {
    history: (product?: Product, stationId?: string) =>
      this.http.get<ProductPrice[]>(`/prices${toQueryString({ product, stationId })}`),
    /** Pass a stationId for one station's current prices; omit it for every active station's current prices. */
    current: (stationId?: string) =>
      this.http.get<Record<Product, ProductPrice | null> | Array<{ station: Station; prices: Record<Product, ProductPrice | null> }>>(
        `/prices/current${toQueryString({ stationId })}`,
      ),
    create: (input: { stationId: string; product: Product; pricePerLitre: number; effectiveFrom: string }) =>
      this.http.post<ProductPrice>('/prices', input),
    reminderSettings: () => this.http.get<PriceReminderSetting>('/price-reminders'),
    updateReminderSettings: (
      input: Partial<{ enabled: boolean; dayOfMonth: number; hourOfDay: number; recipientEmails: string[] }>,
    ) => this.http.patch<PriceReminderSetting>('/price-reminders', input),
  };

  sales = {
    list: (
      params: {
        page?: number;
        pageSize?: number;
        stationId?: string;
        product?: Product;
        from?: string;
        to?: string;
      } = {},
    ) => this.http.get<PaginatedResult<Sale>>(`/sales${toQueryString(params)}`),
    get: (id: string) => this.http.get<Sale>(`/sales/${id}`),
    create: (input: {
      customerPhone: string;
      product: Product;
      amountPaid: number;
      stationId: string;
      idempotencyKey: string;
      saleDate?: string;
    }) => this.http.post<Sale>('/sales', input),
    retrySms: (id: string) => this.http.post(`/sales/${id}/sms/retry`),
    monthlySummary: (customerId: string, month: string) =>
      this.http.get<{ month: string; totalCashback: number; saleCount: number }>(
        `/sales/monthly-summary${toQueryString({ customerId, month })}`,
      ),
    listPendingApproval: (params: { stationId?: string; page?: number; pageSize?: number; cursor?: string } = {}) =>
      this.http.get<PaginatedResult<Sale>>(`/sales/pending-approval${toQueryString(params)}`),
    approveBatch: (saleIds: string[]) =>
      this.http.post<{ approved: string[]; skipped: { saleId: string; reason: string }[] }>('/sales/approve-batch', {
        saleIds,
      }),
    reject: (id: string, reason: string) => this.http.post<Sale>(`/sales/${id}/reject`, { reason }),
  };

  vehiclePlateChecks = {
    /** `viewUrl` is a short-lived signed URL (~15 min) — fetch fresh each time you want to display the photo, don't cache it. */
    get: (id: string) => this.http.get<VehiclePlateCheck & { viewUrl: string }>(`/vehicle-plate-checks/${id}`),
  };

  salesDelegations = {
    listForStation: (stationId: string) =>
      this.http.get<SaleApprovalDelegation[]>(`/sales-delegations${toQueryString({ stationId })}`),
    listEligibleStaff: () => this.http.get<{ id: string; fullName: string; role: string }[]>('/sales-delegations/eligible-staff'),
    create: (input: { stationId: string; delegateUserId: string; startDate: string; endDate: string }) =>
      this.http.post<SaleApprovalDelegation>('/sales-delegations', input),
    revoke: (id: string) => this.http.post<SaleApprovalDelegation>(`/sales-delegations/${id}/revoke`, {}),
  };

  specialRateRequests = {
    list: (status?: string) => this.http.get<SpecialRateRequest[]>(`/special-rate-requests${toQueryString({ status })}`),
    get: (id: string) => this.http.get<SpecialRateRequest>(`/special-rate-requests/${id}`),
    create: (input: {
      customerId: string;
      proposedKesPerLitre: number;
      effectiveFrom: string;
      effectiveTo?: string;
      reason: string;
    }) => this.http.post<SpecialRateRequest>('/special-rate-requests', input),
    approve: (id: string, decisionNote?: string) =>
      this.http.post<SpecialRateRequest>(`/special-rate-requests/${id}/approve`, { decisionNote }),
    reject: (id: string, decisionNote?: string) =>
      this.http.post<SpecialRateRequest>(`/special-rate-requests/${id}/reject`, { decisionNote }),
    revoke: (id: string) => this.http.post<SpecialRateRequest>(`/special-rate-requests/${id}/revoke`, {}),
  };

  customerRegistrations = {
    list: (status?: string) =>
      this.http.get<CustomerRegistrationRequest[]>(`/customer-registrations${toQueryString({ status })}`),
    get: (id: string) => this.http.get<CustomerRegistrationRequest>(`/customer-registrations/${id}`),
    approve: (id: string, decisionNote?: string) =>
      this.http.post<CustomerRegistrationRequest>(`/customer-registrations/${id}/approve`, { decisionNote }),
    reject: (id: string, decisionNote?: string) =>
      this.http.post<CustomerRegistrationRequest>(`/customer-registrations/${id}/reject`, { decisionNote }),
  };

  reconciliation = {
    daily: (params: { stationId?: string; date?: string } = {}) =>
      this.http.get<ReconciliationDaily[]>(`/reconciliation/daily${toQueryString(params)}`),
    get: (id: string) => this.http.get<ReconciliationDaily>(`/reconciliation/daily/${id}`),
    ingestDailyTotals: (input: { stationId: string; product: Product; date: string; totalSales: number }) =>
      this.http.post<ReconciliationDaily>('/reconciliation/daily-totals', input),
  };

  shifts = {
    list: (params: { stationId?: string; date?: string } = {}) =>
      this.http.get<ShiftRoster[]>(`/shifts${toQueryString(params)}`),
    record: (input: { stationId: string; shift: ShiftType; date: string; attendantIds: string[] }) =>
      this.http.post<ShiftRoster>('/shifts', input),
  };

  cashbackLedgers = {
    list: () => this.http.get<MonthlyCashbackLedger[]>('/cashback-ledgers'),
    get: (month: string) => this.http.get<MonthlyCashbackLedger>(`/cashback-ledgers/${month}`),
    submit: (month: string) => this.http.post<MonthlyCashbackLedger>(`/cashback-ledgers/${month}/submit`),
    approve: (month: string) => this.http.post<MonthlyCashbackLedger>(`/cashback-ledgers/${month}/approve`),
    reject: (month: string, reason: string) =>
      this.http.post<MonthlyCashbackLedger>(`/cashback-ledgers/${month}/reject`, { reason }),
  };

  disbursementBatches = {
    list: (month?: string) => this.http.get<DisbursementBatch[]>(`/disbursement-batches${toQueryString({ month })}`),
    get: (id: string) => this.http.get<DisbursementBatch>(`/disbursement-batches/${id}`),
    create: (month: string) => this.http.post<DisbursementBatch>('/disbursement-batches', { month }),
    confirm: (id: string) => this.http.post<DisbursementBatch>(`/disbursement-batches/${id}/confirm`),
    markProcessing: (id: string) => this.http.post<DisbursementBatch>(`/disbursement-batches/${id}/mark-processing`),
    complete: (id: string, results: { customerId: string; status: 'paid' | 'failed'; reference?: string; failureReason?: string }[]) =>
      this.http.post<DisbursementBatch>(`/disbursement-batches/${id}/complete`, { results }),
    hold: (id: string, reason: string) => this.http.post<DisbursementBatch>(`/disbursement-batches/${id}/hold`, { reason }),
    exportFile: (id: string) => this.http.getBlob(`/disbursement-batches/${id}/export.txt`),
  };

  reports = {
    dashboard: (stationId?: string) => this.http.get(`/reports/dashboard${toQueryString({ stationId })}`),
    sales: (params: { stationId?: string; from?: string; to?: string; preset?: string; groupBy?: SalesReportGroupBy } = {}) =>
      this.http.get<{
        sales: Sale[];
        byProduct: Record<string, { count: number; amount: number; cashback: number }>;
        groupBy: SalesReportGroupBy;
        groups: SalesReportGroup[];
      }>(`/reports/sales${toQueryString(params)}`),
    reconciliation: (params: { stationId?: string; date?: string } = {}) =>
      this.http.get(`/reports/reconciliation${toQueryString(params)}`),
    disbursements: (month?: string) => this.http.get(`/reports/disbursements${toQueryString({ month })}`),
    customerActivity: (customerId: string) =>
      this.http.get<{ customer: Customer | null; sales: Sale[] }>(`/reports/customer-activity${toQueryString({ customerId })}`),
  };

  notifications = {
    list: () => this.http.get<Notification[]>('/notifications'),
    markRead: (id: string) => this.http.patch<Notification>(`/notifications/${id}/read`),
    markAllRead: () => this.http.patch<{ success: boolean }>('/notifications/read-all'),
    clearAll: () => this.http.delete<{ success: boolean }>('/notifications'),
  };

  auditEvents = {
    list: (params: { entityType?: string; entityId?: string; cursor?: string } = {}) =>
      this.http.get<PaginatedResult<AuditEvent>>(`/audit-events${toQueryString(params)}`),
  };

  smsDeliveries = {
    list: (params: { cursor?: string } = {}) =>
      this.http.get<PaginatedResult<SmsDelivery>>(`/sms-deliveries${toQueryString(params)}`),
  };

  fraudFlags = {
    list: (
      params: { type?: FraudFlagType; status?: FraudFlagStatus; stationId?: string; customerId?: string; cursor?: string } = {},
    ) => this.http.get<PaginatedResult<FraudFlag>>(`/fraud-flags${toQueryString(params)}`),
    get: (id: string) => this.http.get<FraudFlag>(`/fraud-flags/${id}`),
    startReview: (id: string) => this.http.patch<FraudFlag>(`/fraud-flags/${id}/start-review`, {}),
    resolve: (id: string, note?: string) => this.http.patch<FraudFlag>(`/fraud-flags/${id}/resolve`, { note }),
    dismiss: (id: string, note?: string) => this.http.patch<FraudFlag>(`/fraud-flags/${id}/dismiss`, { note }),
  };

  disbursementSettings = {
    get: () => this.http.get<DisbursementSettings>('/disbursement-settings'),
    update: (input: Partial<{ minDisbursementAmount: number }>) =>
      this.http.patch<DisbursementSettings>('/disbursement-settings', input),
  };

  customerInactivitySettings = {
    get: () => this.http.get<CustomerInactivitySettings>('/customer-inactivity-settings'),
    update: (input: Partial<{ noticeAfterDays: number; resetAfterAdditionalDays: number }>) =>
      this.http.patch<CustomerInactivitySettings>('/customer-inactivity-settings', input),
  };
}
