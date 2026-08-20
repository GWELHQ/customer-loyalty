import { useMemo, useState } from 'react';

const DEFAULT_PAGE_SIZE = 20;

/** Client-side paging over an already-fully-loaded array — for the many tables whose list endpoint has no server-side cap. */
export function usePagedRows<T>(rows: T[], pageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const paged = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [rows, safePage, pageSize],
  );
  return { paged, page: safePage, pageCount, setPage };
}
