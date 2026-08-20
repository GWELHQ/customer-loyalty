import { useState } from 'react';
import { exportToPdf, exportToXlsx, type ExportColumn } from '../lib/exportTable';
import { Button } from './primitives';

/**
 * Always exports the full matching dataset, never just the current page —
 * pass a plain array when `rows` is already complete, or a loader function
 * when the table itself is paginated server-side (e.g. sales, customers).
 */
export function ExportButtons<T>({
  filename,
  title,
  columns,
  rows,
}: {
  filename: string;
  title: string;
  columns: ExportColumn<T>[];
  rows: T[] | (() => Promise<T[]>);
}) {
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(kind: 'xlsx' | 'pdf') {
    setError(null);
    setBusy(kind);
    try {
      const data = typeof rows === 'function' ? await rows() : rows;
      if (kind === 'xlsx') exportToXlsx(filename, columns, data);
      else exportToPdf(filename, title, columns, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export this table');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {error && <span style={{ fontSize: 12, color: 'var(--color-danger)' }}>{error}</span>}
      <Button variant="secondary" size="sm" onClick={() => handle('xlsx')} disabled={busy !== null}>
        {busy === 'xlsx' ? 'Exporting…' : 'Export XLSX'}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => handle('pdf')} disabled={busy !== null}>
        {busy === 'pdf' ? 'Exporting…' : 'Export PDF'}
      </Button>
    </div>
  );
}
