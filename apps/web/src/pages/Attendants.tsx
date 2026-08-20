import type { Attendant, Station } from '@loyalty/shared';
import { UserStatus } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useApi } from '../data/client';
import { useStations } from '../data/useStations';
import { AppShell } from '../layout/AppShell';
import { Badge, Button, Card, Field, Modal, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

export function Attendants() {
  const api = useApi();
  const [attendants, setAttendants] = useState<Attendant[]>([]);
  const { stations } = useStations();
  const [showForm, setShowForm] = useState(false);
  const [pinModalFor, setPinModalFor] = useState<Attendant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    api.attendants.list().then(setAttendants);
  }
  useEffect(reload, [api]);

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

  return (
    <AppShell title="Attendants" subtitle="Android pump-attendant accounts — PIN login, one station each">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12 }}>
            {error}
          </div>
        )}
        <div>
          <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'Add attendant'}
          </Button>
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
              {attendants.map((a) => (
                <Tr key={a.id}>
                  <Td>{a.fullName}</Td>
                  <Td>{a.employeeId}</Td>
                  <Td>{stations.find((s) => s.id === a.assignedStationId)?.name ?? a.assignedStationId}</Td>
                  <Td>
                    <Badge tone={a.status === UserStatus.ACTIVE ? 'success' : 'neutral'}>{a.status}</Badge>
                  </Td>
                  <Td align="right">
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button variant="secondary" size="sm" onClick={() => setPinModalFor(a)}>
                        Reset PIN
                      </Button>
                      <Button variant="secondary" size="sm" disabled={busyId === a.id} onClick={() => toggleStatus(a)}>
                        {busyId === a.id ? 'Working…' : a.status === UserStatus.ACTIVE ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      {pinModalFor && <ResetPinModal attendant={pinModalFor} onClose={() => setPinModalFor(null)} />}
    </AppShell>
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
          <Field label="New 4–6 digit PIN">
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
        <Field label="Full name">
          <input style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Employee ID">
          <input style={inputStyle} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="KIS1-003" />
        </Field>
        <Field label="Assigned station (exactly one)">
          <select style={inputStyle} value={assignedStationId} onChange={(e) => setAssignedStationId(e.target.value)}>
            <option value="">Choose station</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Initial PIN (4–6 digits)">
          <input style={inputStyle} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="1234" />
        </Field>
      </div>
      <Button variant="primary" onClick={submit} disabled={busy || !fullName || !employeeId || !assignedStationId || !pin} style={{ marginTop: 14 }}>
        {busy ? 'Creating…' : 'Create attendant'}
      </Button>
    </Card>
  );
}
