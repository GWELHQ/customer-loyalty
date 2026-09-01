import { useMemo, useState } from 'react';

/** Client-side free-text substring filter — same pattern CustomersList.tsx already used inline, extracted for reuse across every list page. */
export function useTextFilter<T>(rows: T[], getText: (row: T) => string) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => getText(r).toLowerCase().includes(needle));
  }, [rows, search, getText]);
  return { search, setSearch, filtered };
}
