import type { ShiftRoster, Station } from '@loyalty/shared';
import { Permission, Role, ShiftType } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useAttendantsCache } from '../data/entityCaches';
import { useRealtimeRefresh } from '../data/realtime';
import { useStations } from '../data/useStations';
import { AppShell } from '../layout/AppShell';
import { nairobiToday } from '../lib/time';
import { Badge, Button, Card, Field, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

const SHIFT_LABEL: Record<ShiftType, string> = {
  [ShiftType.DAY]: 'Day (07:30–16:30)',
  [ShiftType.NIGHT]: 'Night (16:30–07:30)',
};

export function Shifts() {
  const api = useApi();
  const { user, hasPermission } = useAuth();
  const canManage = hasPermission(Permission.SHIFTS_MANAGE);
  const lockedStationId = user?.role === Role.STATION_SUPERVISOR ? user.assignedStationId : undefined;
  const { stations } = useStations();
  const { items: attendants } = useAttendantsCache();
  const [date, setDate] = useState(nairobiToday);
  const [records, setRecords] = useState<ShiftRoster[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [stationFilter, setStationFilter] = useState('');
  const [shiftFilter, setShiftFilter] = useState('');
  const filtered = records.filter(
    (r) => (!stationFilter || r.stationId === stationFilter) && (!shiftFilter || r.shift === shiftFilter),
  );

  function reload() {
    api.shifts.list({ date }).then(setRecords);
  }
  useEffect(reload, [api, date]);
  useRealtimeRefresh(['shiftRosters'], reload);

  function attendantName(id: string): string {
    return attendants.find((a) => a.id === id)?.fullName ?? 'Unknown attendant';
  }

  return (
    <AppShell title="Shifts" subtitle="Daily record of which attendants are on duty, per station and shift">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1100 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="date" style={{ ...inputStyle, maxWidth: 180 }} value={date} onChange={(e) => setDate(e.target.value)} />
          {!lockedStationId && stations.length > 0 && (
            <select style={{ ...inputStyle, maxWidth: 200 }} value={stationFilter} onChange={(e) => setStationFilter(e.target.value)}>
              <option value="">All stations</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <select style={{ ...inputStyle, maxWidth: 180 }} value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)}>
            <option value="">All shifts</option>
            <option value={ShiftType.DAY}>{SHIFT_LABEL[ShiftType.DAY]}</option>
            <option value={ShiftType.NIGHT}>{SHIFT_LABEL[ShiftType.NIGHT]}</option>
          </select>
          <div style={{ flex: 1 }} />
          {canManage && (
            <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : 'Record roster'}
            </Button>
          )}
        </div>

        {showForm && (
          <RosterForm
            stations={stations}
            attendants={attendants}
            defaultDate={date}
            lockedStationId={lockedStationId}
            onDone={() => {
              setShowForm(false);
              reload();
            }}
          />
        )}

        <Card padding={0}>
          {filtered.length === 0 && (
            <div style={{ padding: 20, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              No shift rosters recorded for this date yet.
            </div>
          )}
          {filtered.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>Station</Th>
                  <Th>Shift</Th>
                  <Th>Sales assistants on duty</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <Tr key={r.id}>
                    <Td>{stations.find((s) => s.id === r.stationId)?.name ?? 'Unknown station'}</Td>
                    <Td>
                      <Badge tone={r.shift === ShiftType.DAY ? 'info' : 'neutral'}>{SHIFT_LABEL[r.shift]}</Badge>
                    </Td>
                    <Td>
                      {r.attendantIds.length === 0 ? (
                        <span style={{ color: 'var(--color-text-muted)' }}>None scheduled</span>
                      ) : (
                        r.attendantIds.map((id) => attendantName(id)).join(', ')
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function RosterForm({
  stations,
  attendants,
  defaultDate,
  lockedStationId,
  onDone,
}: {
  stations: Station[];
  attendants: { id: string; fullName: string; assignedStationId: string }[];
  defaultDate: string;
  lockedStationId?: string;
  onDone: () => void;
}) {
  const api = useApi();
  const [stationId, setStationId] = useState(lockedStationId ?? '');
  const [shift, setShift] = useState<ShiftType>(ShiftType.DAY);
  const [date, setDate] = useState(defaultDate);
  const [attendantIds, setAttendantIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stationAttendants = attendants.filter((a) => a.assignedStationId === stationId);

  function toggle(id: string) {
    setAttendantIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.shifts.record({ stationId, shift, date: new Date(date).toISOString(), attendantIds });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this roster');
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <Field label="Station" required>
          {lockedStationId ? (
            <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', color: 'var(--color-text-secondary)' }}>
              {stations.find((s) => s.id === lockedStationId)?.name ?? 'Your station'}
            </div>
          ) : (
            <select style={inputStyle} value={stationId} onChange={(e) => setStationId(e.target.value)}>
              <option value="">Choose station</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Shift" required>
          <select style={inputStyle} value={shift} onChange={(e) => setShift(e.target.value as ShiftType)}>
            <option value={ShiftType.DAY}>{SHIFT_LABEL[ShiftType.DAY]}</option>
            <option value={ShiftType.NIGHT}>{SHIFT_LABEL[ShiftType.NIGHT]}</option>
          </select>
        </Field>
        <Field label="Date" required>
          <input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <Field label="Sales assistants on duty">
          {!stationId ? (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Choose a station to list its sales assistants.</div>
          ) : stationAttendants.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No sales assistants assigned to this station.</div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                padding: 12,
                maxHeight: 240,
                overflowY: 'auto',
              }}
            >
              {stationAttendants.map((a) => (
                <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                  <input type="checkbox" checked={attendantIds.includes(a.id)} onChange={() => toggle(a.id)} />
                  {a.fullName}
                </label>
              ))}
            </div>
          )}
        </Field>
      </div>

      <Button variant="primary" onClick={submit} disabled={busy || !stationId} style={{ marginTop: 14 }}>
        {busy ? 'Saving…' : 'Save roster'}
      </Button>
    </Card>
  );
}
