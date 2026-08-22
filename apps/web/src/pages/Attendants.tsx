import type { Attendant, Station } from '@loyalty/shared';
import { UserStatus } from '@loyalty/shared';
import { useState } from 'react';
import { useApi } from '../data/client';
import { useAttendantsCache } from '../data/entityCaches';
import { usePagedRows } from '../data/usePagedRows';
import { useStations } from '../data/useStations';
import { AppShell } from '../layout/AppShell';
import type { ExportColumn } from '../lib/exportTable';
import { ExportButtons } from '../ui/ExportButtons';
import { Icon } from '../ui/Icon';
import { Badge, Button, Card, Field, Modal, Pagination, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

function attendantColumns(stations: Station[]): ExportColumn<Attendant>[] {
  return [
    { header: 'Name', value: (a) => a.fullName },
    { header: 'Employee ID', value: (a) => a.employeeId },
    { header: 'Station', value: (a) => stations.find((s) => s.id === a.assignedStationId)?.name ?? 'Unknown station' },
    { header: 'Status', value: (a) => a.status },
  ];
}

export function Attendants() {
  const api = useApi();
  const { items: attendants, refresh: reload } = useAttendantsCache();
  const { stations } = useStations();
  const { paged, page, pageCount, setPage } = usePagedRows(attendants);
  const [showForm, setShowForm] = useState(false);
  const [pinModalFor, setPinModalFor] = useState<Attendant | null>(null);
  const [editing, setEditing] = useState<Attendant | null>(null);
  const [deleting, setDeleting] = useState<Attendant | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleStatus(a: Attendant) {
    setError(null);
    setBusyId(a.id);
    try {
      await api.attendants.setStatus(a.id, a.status === UserStatus.ACTIVE ? UserStatus.INACTIVE : UserStatus.ACTIVE);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not update ${a.fullName}'s status`);
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await api.attendants.delete(deleting.id);
      setDeleting(null);
      reload();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete this attendant');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <AppShell title="Attendants" subtitle="Android pump-attendant accounts — PIN login, one station each">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'Add attendant'}
          </Button>
          <div style={{ flex: 1 }} />
          <ExportButtons filename="attendants" title="Attendants" columns={attendantColumns(stations)} rows={attendants} />
        </div>
        {showForm && (
          <AttendantForm
            stations={stations}
            onDone={() => {
              setShowForm(false);
              reload();
            }}
          />
        )}

        <Card padding={0}>
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Employee ID</Th>
                <Th>Station</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {paged.map((a) => (
                <Tr key={a.id}>
                  <Td>{a.fullName}</Td>
                  <Td>{a.employeeId}</Td>
                  <Td>{stations.find((s) => s.id === a.assignedStationId)?.name ?? 'Unknown station'}</Td>
                  <Td>
                    <Badge tone={a.status === UserStatus.ACTIVE ? 'success' : 'neutral'}>{a.status}</Badge>
                  </Td>
                  <Td align="right">
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button variant="secondary" size="sm" onClick={() => setEditing(a)}>
                        Edit
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setPinModalFor(a)}>
                        Reset PIN
                      </Button>
                      <Button variant="secondary" size="sm" disabled={busyId === a.id} onClick={() => toggleStatus(a)}>
                        {busyId === a.id ? 'Working…' : a.status === UserStatus.ACTIVE ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleting(a);
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        <Icon name="trash" size={13} />
                        Delete
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageCount={pageCount} onChange={setPage} totalLabel={`${attendants.length} attendant(s)`} />
        </Card>
      </div>

      {pinModalFor && <ResetPinModal attendant={pinModalFor} onClose={() => setPinModalFor(null)} />}

      {editing && (
        <Modal title={`Edit ${editing.fullName}`} onClose={() => setEditing(null)}>
          <EditAttendantForm
            attendant={editing}
            stations={stations}
            onDone={() => {
              setEditing(null);
              reload();
            }}
          />
        </Modal>
      )}

      {deleting && (
        <Modal title={`Delete ${deleting.fullName}?`} onClose={() => !deleteBusy && setDeleting(null)}>
          <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            This permanently deletes <strong>{deleting.fullName}</strong> ({deleting.employeeId}). Only allowed if they have no recorded sales — otherwise, deactivate them instead.
          </div>
          {deleteError && (
            <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12, marginTop: 12 }}>
              {deleteError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Button variant="danger" onClick={confirmDelete} disabled={deleteBusy}>
              {deleteBusy ? 'Deleting…' : 'Delete permanently'}
            </Button>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}

function EditAttendantForm({
  attendant,
  stations,
  onDone,
}: {
  attendant: Attendant;
  stations: Station[];
  onDone: () => void;
}) {
  const api = useApi();
  const [fullName, setFullName] = useState(attendant.fullName);
  const [employeeId, setEmployeeId] = useState(attendant.employeeId);
  const [assignedStationId, setAssignedStationId] = useState(attendant.assignedStationId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.attendants.update(attendant.id, { fullName, employeeId });
      if (assignedStationId !== attendant.assignedStationId) {
        await api.attendants.assignStation(attendant.id, assignedStationId);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && (
        <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Full name" required>
          <input style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Employee ID" required>
          <input style={inputStyle} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />
        </Field>
        <Field label="Assigned station" required>
          <select style={inputStyle} value={assignedStationId} onChange={(e) => setAssignedStationId(e.target.value)}>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <Button variant="primary" onClick={submit} disabled={busy || !fullName || !employeeId}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ResetPinModal({ attendant, onClose }: { attendant: Attendant; onClose: () => void }) {
  const api = useApi();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const pinValid = /^\d{4,6}$/.test(pin);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await api.attendants.resetPin(attendant.id, pin);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset PIN');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Reset PIN — ${attendant.fullName}`} onClose={onClose}>
      {done ? (
        <div>
          <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)' }}>
            PIN reset. Share the new PIN with {attendant.fullName} directly.
          </div>
          <Button variant="primary" onClick={onClose} style={{ marginTop: 16 }}>
            Done
          </Button>
        </div>
      ) : (
        <div>
          {error && (
            <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              {error}
            </div>
          )}
          <Field label="New 4–6 digit PIN" required>
            <input
              style={inputStyle}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="1234"
              autoFocus
              inputMode="numeric"
            />
          </Field>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Button variant="primary" onClick={submit} disabled={busy || !pinValid}>
              {busy ? 'Resetting…' : 'Reset PIN'}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function AttendantForm({ stations, onDone }: { stations: Station[]; onDone: () => void }) {
  const api = useApi();
  const [fullName, setFullName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [assignedStationId, setAssignedStationId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await api.attendants.create({ fullName, employeeId, assignedStationId, pin });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create attendant');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      {error && (
        <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Full name" required>
          <input style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Employee ID" required>
          <input style={inputStyle} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="KIS1-003" />
        </Field>
        <Field label="Assigned station (exactly one)" required>
          <select style={inputStyle} value={assignedStationId} onChange={(e) => setAssignedStationId(e.target.value)}>
            <option value="">Choose station</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Initial PIN (4–6 digits)" required>
          <input style={inputStyle} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="1234" />
        </Field>
      </div>
      <Button variant="primary" onClick={submit} disabled={busy || !fullName || !employeeId || !assignedStationId || !pin} style={{ marginTop: 14 }}>
        {busy ? 'Creating…' : 'Create attendant'}
      </Button>
    </Card>
  );
}
