import type { Attendant, Station } from '@loyalty/shared';
import { Role, UserStatus } from '@loyalty/shared';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useAttendantsCache } from '../data/entityCaches';
import { usePagedRows } from '../data/usePagedRows';
import { useTextFilter } from '../data/useTextFilter';
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
    { header: 'RFID/NFC badge assigned', value: (a) => (a.nfcTagId ? 'Yes' : 'No') },
  ];
}

export function Attendants() {
  const api = useApi();
  const { user } = useAuth();
  const { items: attendants, refresh: reload } = useAttendantsCache();
  const { stations } = useStations();
  // A Station Supervisor only ever sees/manages attendants at their own
  // station — the API already enforces this server-side, but locking the
  // station picker here too avoids a confusing "choose any station, then
  // get a 403" round trip.
  const lockedStationId = user?.role === Role.STATION_SUPERVISOR ? (user.assignedStationId ?? undefined) : undefined;
  const [stationFilter, setStationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const filteredByColumns = useMemo(
    () =>
      attendants.filter(
        (a) => (!stationFilter || a.assignedStationId === stationFilter) && (!statusFilter || a.status === statusFilter),
      ),
    [attendants, stationFilter, statusFilter],
  );
  const { search, setSearch, filtered } = useTextFilter(filteredByColumns, (a) => `${a.fullName} ${a.employeeId}`);
  const { paged, page, pageCount, setPage } = usePagedRows(filtered);
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
      setDeleteError(err instanceof Error ? err.message : 'Could not delete this service assistant');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <AppShell title="Service Assistants" subtitle="Android pump service-assistant accounts — PIN login, one station each">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'Add service assistant'}
          </Button>
          <input
            placeholder="Search by name or employee ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, maxWidth: 240 }}
          />
          {!lockedStationId && stations.length > 0 && (
            <select style={{ ...inputStyle, maxWidth: 180 }} value={stationFilter} onChange={(e) => setStationFilter(e.target.value)}>
              <option value="">All stations</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <select style={{ ...inputStyle, maxWidth: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value={UserStatus.ACTIVE}>Active</option>
            <option value={UserStatus.INACTIVE}>Inactive</option>
          </select>
          <div style={{ flex: 1 }} />
          <ExportButtons filename="attendants" title="Service Assistants" columns={attendantColumns(stations)} rows={filtered} />
        </div>
        {showForm && (
          <AttendantForm
            stations={stations}
            lockedStationId={lockedStationId}
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
                <Th>Badge</Th>
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
                  <Td>{a.nfcTagId ? <Badge tone="info">Assigned</Badge> : <span style={{ color: 'var(--color-text-muted)' }}>None</span>}</Td>
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
          <Pagination page={page} pageCount={pageCount} onChange={setPage} totalLabel={`${filtered.length} service assistant(s)`} />
        </Card>
      </div>

      {pinModalFor && <ResetPinModal attendant={pinModalFor} onClose={() => setPinModalFor(null)} />}

      {editing && (
        <Modal title={`Edit ${editing.fullName}`} onClose={() => setEditing(null)}>
          <EditAttendantForm
            attendant={editing}
            stations={stations}
            lockedStationId={lockedStationId}
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
  lockedStationId,
  onDone,
}: {
  attendant: Attendant;
  stations: Station[];
  lockedStationId?: string;
  onDone: () => void;
}) {
  const api = useApi();
  const [fullName, setFullName] = useState(attendant.fullName);
  const [employeeId, setEmployeeId] = useState(attendant.employeeId);
  const [assignedStationId, setAssignedStationId] = useState(attendant.assignedStationId);
  const [nfcTagId, setNfcTagId] = useState(attendant.nfcTagId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // nfcTagId is always sent, even empty — the backend treats an omitted
      // field as "leave unchanged" but an empty string as "clear it", so
      // unassigning a lost/stolen badge needs the explicit empty string.
      await api.attendants.update(attendant.id, { fullName, employeeId, nfcTagId });
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
          {lockedStationId ? (
            <input style={inputStyle} value={stations.find((s) => s.id === lockedStationId)?.name ?? 'Your station'} disabled />
          ) : (
            <select style={inputStyle} value={assignedStationId} onChange={(e) => setAssignedStationId(e.target.value)}>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="RFID/NFC badge UID">
          <input
            style={inputStyle}
            value={nfcTagId}
            onChange={(e) => setNfcTagId(e.target.value)}
            placeholder="Scanned badge UID — leave blank for none"
          />
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

function AttendantForm({
  stations,
  lockedStationId,
  onDone,
}: {
  stations: Station[];
  lockedStationId?: string;
  onDone: () => void;
}) {
  const api = useApi();
  const [fullName, setFullName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [assignedStationId, setAssignedStationId] = useState(lockedStationId ?? '');
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
      setError(err instanceof Error ? err.message : 'Could not create service assistant');
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
          {lockedStationId ? (
            <input style={inputStyle} value={stations.find((s) => s.id === lockedStationId)?.name ?? 'Your station'} disabled />
          ) : (
            <select style={inputStyle} value={assignedStationId} onChange={(e) => setAssignedStationId(e.target.value)}>
              <option value="">Choose station</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Initial PIN (4–6 digits)" required>
          <input style={inputStyle} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="1234" />
        </Field>
      </div>
      <Button variant="primary" onClick={submit} disabled={busy || !fullName || !employeeId || !assignedStationId || !pin} style={{ marginTop: 14 }}>
        {busy ? 'Creating…' : 'Create service assistant'}
      </Button>
    </Card>
  );
}
