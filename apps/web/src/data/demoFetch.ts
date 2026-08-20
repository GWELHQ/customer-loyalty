import {
  demoCustomers,
  demoLedger,
  demoNotifications,
  demoPrices,
  demoSpecialRateRequests,
  demoStations,
  demoUsers,
} from './demoData';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Minimal in-memory stand-in for the API, wired in as a custom fetch
 * implementation on the same LoyaltyApiClient the real app uses (see
 * data/client.tsx) — pages never know whether they're talking to this or
 * the real backend, satisfying the "interchangeable adapters" requirement
 * at the transport boundary instead of duplicating page-level data logic.
 */
export async function demoFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const path = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1/, '');
  const method = (init?.method ?? 'GET').toUpperCase();

  if (path === '/auth/me') {
    return json(demoUsers[0]);
  }
  if (path === '/stations' && method === 'GET') return json(demoStations);
  if (path === '/users' && method === 'GET') return json(demoUsers);
  if (path.startsWith('/customers/search')) {
    const phone = new URL(url, 'http://x').searchParams.get('phone') ?? '';
    return json(demoCustomers.filter((c) => c.phoneNumber.includes(phone.replace(/\D/g, ''))));
  }
  if (path.startsWith('/customers') && method === 'GET') {
    return json({ items: demoCustomers, page: 1, pageSize: 20, total: demoCustomers.length, nextCursor: null });
  }
  if (path === '/prices/current') return json(demoPrices);
  if (path.startsWith('/prices') && method === 'GET') return json([demoPrices.PMS]);
  if (path === '/special-rate-requests' && method === 'GET') return json(demoSpecialRateRequests);
  if (path.startsWith('/customer-registrations') && method === 'GET') return json([]);
  if (path.startsWith('/cashback-ledgers/')) return json(demoLedger);
  if (path === '/cashback-ledgers') return json([demoLedger]);
  if (path === '/notifications') return json(demoNotifications);
  if (path === '/reports/dashboard') {
    return json({
      month: '2026-08',
      totalCashbackMonth: 2040,
      totalSalesAmountMonth: 512000,
      saleCount: 214,
      uniqueCustomers: 87,
      pendingSpecialRateRequests: 1,
      reconciliationRecordsNeedingAttention: 2,
    });
  }
  if (path === '/sales' && method === 'GET') return json({ items: [], page: 1, pageSize: 20, total: 0, nextCursor: null });
  if (path === '/audit-events') return json([]);
  if (path.startsWith('/reconciliation/daily')) return json([]);
  if (path === '/disbursement-batches') return json([]);

  // Fallback for anything not stubbed: succeed with an empty body so the UI
  // doesn't hard-crash while browsing demo mode.
  return json({});
}
