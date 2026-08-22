import type { ImportJob, ImportRow, Station } from '@loyalty/shared';
import { ImportRowResult } from '@loyalty/shared';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../data/client';
import { useStations } from '../../data/useStations';
import { AppShell } from '../../layout/AppShell';
import { Icon } from '../../ui/Icon';
import { Button, Card, Table, Td, Th, Tr, inputStyle } from '../../ui/primitives';

function stationLabel(s: Station): string {
  return `${s.code}.${s.name}`;
}

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
  1: 'Upload file',
  2: 'Column mapping',
  3: 'Check rows',
  4: 'Done',
};

export function CustomerImportWizard() {
  const api = useApi();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [duplicateDecisions, setDuplicateDecisions] = useState<Record<string, 'skip' | 'merge'>>({});
  const { stations } = useStations();
  const [homeStationId, setHomeStationId] = useState('');
  const [nameColumn, setNameColumn] = useState('');
  const [phoneColumn, setPhoneColumn] = useState('');

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const createdJob = await api.customers.uploadImport(file, homeStationId);
      setJob(createdJob);
      setNameColumn(Object.entries(createdJob.columnMapping).find(([, field]) => field === 'fullName')?.[0] ?? '');
      setPhoneColumn(Object.entries(createdJob.columnMapping).find(([, field]) => field === 'phoneNumber')?.[0] ?? '');
      const jobRows = await api.customers.getImportResults(createdJob.id);
      setRows(jobRows);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file');
    } finally {
      setBusy(false);
    }
  }

  async function applyMapping() {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const updatedJob = await api.customers.remapImport(job.id, {
        [nameColumn]: 'fullName',
        [phoneColumn]: 'phoneNumber',
      });
      setJob(updatedJob);
      const jobRows = await api.customers.getImportResults(updatedJob.id);
      setRows(jobRows);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply that column mapping');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const completed = await api.customers.confirmImport(job.id, duplicateDecisions);
      setJob(completed);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete the import');
    } finally {
      setBusy(false);
    }
  }

  const created = rows.filter((r) => r.result === ImportRowResult.CREATED);
  const duplicates = rows.filter((r) => r.result === ImportRowResult.DUPLICATE_SKIPPED);
  const rejected = rows.filter((r) => r.result === ImportRowResult.REJECTED);

  return (
    <AppShell title="Import customers" subtitle="Guided Excel import — nothing is created until the last step">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1000 }}>
        <Card padding={16}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {([1, 2, 3, 4] as Step[]).map((s, i) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: s === step ? 'var(--color-primary)' : s < step ? 'var(--gw-green-100)' : 'var(--color-surface-sunken)',
                    color: s === step ? '#fff' : s < step ? 'var(--gw-green-700)' : 'var(--color-text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {s}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: s === step ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>
                  {STEP_LABELS[s]}
                </span>
                {i < 3 && <span style={{ color: 'var(--color-border-strong)', marginLeft: 4 }}>→</span>}
              </div>
            ))}
          </div>
        </Card>

        <Card padding={20}>
          {error && (
            <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
              {error}
            </div>
          )}

          {step === 1 && (
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18 }}>Upload a customer list</div>
              <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                Each file is imported as a batch for one branch — every customer in the file will be assigned to the branch you pick below.
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                  Branch
                  <span style={{ color: 'var(--color-danger)', marginLeft: 3 }} aria-hidden="true">
                    *
                  </span>
                </div>
                <select
                  style={inputStyle}
                  value={homeStationId}
                  onChange={(e) => setHomeStationId(e.target.value)}
                >
                  <option value="">Select a branch…</option>
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {stationLabel(s)}
                    </option>
                  ))}
                </select>
              </div>

              <div
                style={{
                  marginTop: 18,
                  border: '2px dashed var(--color-border-strong)',
                  borderRadius: 12,
                  padding: 34,
                  textAlign: 'center',
                  background: 'var(--color-surface-sunken)',
                  opacity: homeStationId ? 1 : 0.6,
                }}
              >
                <Icon name="upload" size={24} color="var(--color-text-muted)" />
                <div style={{ fontWeight: 700, fontSize: 15, marginTop: 8 }}>Drop an Excel file here, or choose one</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>.xlsx or .csv · up to 5,000 rows per file</div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  style={{ display: 'none' }}
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
                <Button
                  variant="primary"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy || !homeStationId}
                  style={{ marginTop: 14 }}
                >
                  {busy ? 'Reading file…' : !homeStationId ? 'Select a branch first' : 'Choose file'}
                </Button>
              </div>
              <div
                style={{
                  marginTop: 14,
                  background: 'var(--color-warning-tint)',
                  border: '1px solid var(--gw-amber-500)',
                  borderRadius: 8,
                  padding: 13,
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ color: 'var(--color-text)' }}>Required columns:</strong> Customer name, Phone number.
              </div>
            </div>
          )}

          {step === 2 && job && (
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18 }}>Column mapping</div>
              <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                File: <strong style={{ color: 'var(--color-text)' }}>{job.fileName}</strong> · {job.totalRows} rows · Branch:{' '}
                <strong style={{ color: 'var(--color-text)' }}>{job.homeStationName}</strong>
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                Pick which column in the file has each value. We guessed based on the header names — change either if the guess is wrong.
              </div>
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 30px 1fr',
                    gap: 12,
                    alignItems: 'center',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    padding: '11px 13px',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Customer field</div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-primary)' }}>
                      Customer name
                      <span style={{ color: 'var(--color-danger)', marginLeft: 3 }} aria-hidden="true">
                        *
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>←</div>
                  <select style={inputStyle} value={nameColumn} onChange={(e) => setNameColumn(e.target.value)}>
                    <option value="">Select a column…</option>
                    {job.allHeaders.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 30px 1fr',
                    gap: 12,
                    alignItems: 'center',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    padding: '11px 13px',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Customer field</div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-primary)' }}>
                      Phone number
                      <span style={{ color: 'var(--color-danger)', marginLeft: 3 }} aria-hidden="true">
                        *
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>←</div>
                  <select style={inputStyle} value={phoneColumn} onChange={(e) => setPhoneColumn(e.target.value)}>
                    <option value="">Select a column…</option>
                    {job.allHeaders.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Button
                variant="primary"
                onClick={applyMapping}
                disabled={busy || !nameColumn || !phoneColumn || nameColumn === phoneColumn}
                style={{ marginTop: 16 }}
              >
                {busy ? 'Applying…' : 'Check the rows'}
              </Button>
              {nameColumn && nameColumn === phoneColumn && (
                <div style={{ fontSize: 12.5, color: 'var(--color-danger)', marginTop: 8 }}>
                  Customer name and Phone number can't use the same column.
                </div>
              )}
            </div>
          )}

          {step === 3 && job && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                <CountTile value={created.length} label="Will be created" tone="success" />
                <CountTile value={duplicates.length} label="Already on record" tone="warning" />
                <CountTile value={rejected.length} label="Need correction" tone="danger" />
              </div>

              {created.length > 0 && (
                <>
                  <div style={{ marginTop: 18, fontWeight: 700, fontSize: 14.5 }}>Customers that will be created</div>
                  <div style={{ marginTop: 10, border: '1px solid var(--color-border)', borderRadius: 8, maxHeight: 360, overflow: 'auto' }}>
                    <Table>
                      <thead>
                        <tr>
                          <Th>Row</Th>
                          <Th>Name</Th>
                          <Th>Phone</Th>
                          <Th>Home station</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {created.map((r) => (
                          <Tr key={r.rowNumber}>
                            <Td>{r.rowNumber}</Td>
                            <Td>{r.rawData.__mappedFullName}</Td>
                            <Td>{r.rawData.__normalizedPhone}</Td>
                            <Td>{job.homeStationName}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </>
              )}

              {duplicates.length > 0 && (
                <>
                  <div style={{ marginTop: 18, fontWeight: 700, fontSize: 14.5 }}>Duplicate phone numbers — decide for each</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 3 }}>
                    These numbers already exist centrally. Nothing is created twice.
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {duplicates.map((d) => (
                      <div key={d.rowNumber} style={{ border: '1px solid var(--color-border)', borderLeft: '4px solid var(--gw-amber-500)', borderRadius: 8, padding: 13 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Row {d.rowNumber}</div>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{d.rawData.__mappedFullName}</div>
                            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{d.problem}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {(['skip', 'merge'] as const).map((action) => (
                              <button
                                key={action}
                                onClick={() => setDuplicateDecisions((prev) => ({ ...prev, [d.rowNumber]: action }))}
                                style={{
                                  height: 34,
                                  padding: '0 12px',
                                  borderRadius: 8,
                                  border: '1px solid var(--color-border-strong)',
                                  background:
                                    (duplicateDecisions[d.rowNumber] ?? 'skip') === action
                                      ? 'var(--color-primary)'
                                      : 'var(--color-surface)',
                                  color: (duplicateDecisions[d.rowNumber] ?? 'skip') === action ? '#fff' : 'var(--color-text)',
                                  fontSize: 12.5,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                {action === 'skip' ? 'Skip' : 'Update home station'}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {rejected.length > 0 && (
                <>
                  <div style={{ marginTop: 18, fontWeight: 700, fontSize: 14.5 }}>Rows needing correction</div>
                  <div style={{ marginTop: 10, border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
                    {rejected.map((r) => (
                      <div
                        key={r.rowNumber}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '60px 1fr 1.2fr',
                          gap: 12,
                          padding: '11px 13px',
                          borderBottom: '1px solid var(--color-border)',
                          fontSize: 13,
                        }}
                      >
                        <span style={{ color: 'var(--color-text-muted)' }}>Row {r.rowNumber}</span>
                        <span style={{ fontWeight: 600 }}>{r.rawData.__mappedFullName || '—'}</span>
                        <span style={{ color: 'var(--color-danger)' }}>{r.problem}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <Button variant="primary" onClick={confirm} disabled={busy}>
                  {busy ? 'Importing…' : `Import ${created.length} customer(s)`}
                </Button>
                <Button variant="secondary" onClick={() => setStep(2)}>
                  Back to mapping
                </Button>
              </div>
            </div>
          )}

          {step === 4 && job && (
            <div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--color-success-tint)', border: '1px solid var(--gw-green-200)', borderRadius: 10, padding: 15 }}>
                <Icon name="checkCircle" size={22} color="var(--color-success)" />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Import finished</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    {job.createdCount} customers are now available at every station.
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <Button variant="primary" onClick={() => navigate('/customers')}>
                  View customers
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStep(1);
                    setJob(null);
                    setRows([]);
                    setDuplicateDecisions({});
                    setHomeStationId('');
                  }}
                >
                  Import another file
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function CountTile({ value, label, tone }: { value: number; label: string; tone: 'success' | 'warning' | 'danger' }) {
  const colors = {
    success: { border: 'var(--gw-green-200)', bg: 'var(--color-success-tint)', color: 'var(--color-success)' },
    warning: { border: 'var(--gw-amber-500)', bg: 'var(--color-warning-tint)', color: 'var(--gw-amber-600)' },
    danger: { border: 'var(--gw-red-500)', bg: 'var(--color-danger-tint)', color: 'var(--color-danger)' },
  }[tone];
  return (
    <div style={{ border: `1px solid ${colors.border}`, background: colors.bg, borderRadius: 8, padding: 13 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, color: colors.color }}>{value}</div>
      <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 2 }}>{label}</div>
    </div>
  );
}
