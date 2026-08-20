import type {
  Attendant,
  CustomerRegistrationRequest,
  DisbursementBatch,
  Notification,
  SpecialRateRequest,
  User,
} from '@loyalty/shared';
import { createCachedListHook } from './createCachedList';

export const { useCachedList: useAttendantsCache, invalidate: invalidateAttendantsCache } =
  createCachedListHook<Attendant>((api) => api.attendants.list(), ['attendants']);

export const { useCachedList: useUsersCache, invalidate: invalidateUsersCache } = createCachedListHook<User>(
  (api) => api.users.list(),
  ['users'],
);

export const { useCachedList: useSpecialRateRequestsCache, invalidate: invalidateSpecialRateRequestsCache } =
  createCachedListHook<SpecialRateRequest>((api) => api.specialRateRequests.list(), ['specialRateRequests']);

export const {
  useCachedList: useCustomerRegistrationsCache,
  invalidate: invalidateCustomerRegistrationsCache,
} = createCachedListHook<CustomerRegistrationRequest>(
  (api) => api.customerRegistrations.list(),
  ['customerRegistrationRequests'],
);

export const { useCachedList: useDisbursementBatchesCache, invalidate: invalidateDisbursementBatchesCache } =
  createCachedListHook<DisbursementBatch>((api) => api.disbursementBatches.list(), ['disbursementBatches']);

export const { useCachedList: useNotificationsCache, invalidate: invalidateNotificationsCache } =
  createCachedListHook<Notification>((api) => api.notifications.list(), ['notifications']);
