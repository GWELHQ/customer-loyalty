import type { Station } from '@loyalty/shared';
import { Permission } from '@loyalty/shared';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useStations } from '../data/useStations';
import { AppShell } from '../layout/AppShell';
import { Badge, Button, Card, Field, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

export function Stations() {
  const api = useApi();
  const { hasPermission } = useAuth();
  const canManage = hasPermission(Permission.STATIONS_MANAGE);
  const { stations, refresh } = useStations();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleActive(station: Station) {
    setError(null);
    setBusyId(station.id);
    try {
      await api.stations.update(station.id, { active: !station.active });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not update ${station.name}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell title="Stations" subtitle="Kisumu 1, Kisumu 2, Ugunja, Mbita and any future locations">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 800 }}>
        {error && (
          <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12 }}>
            {error}
          </div>
        )}
        {canManage && (
          <div>
            <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : 'Add station'}
            </Button>
          </div>
        )}
        {showForm && (
          <StationForm
            onDone={() => {
              setShowForm(false);
              refresh();
            }}
          />
        )}

        <Card padding={0}>
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Code</Th>
                <Th>Location</Th>
                <Th>Status</Th>
                {canManage && <Th align="right">Actions</Th>}
              </tr>
            </thead>
            <tbody>
              {stations.map((s) => (
                <Tr key={s.id}>
                  <Td>{s.name}</Td>
                  <Td>{s.code}</Td>
                  <Td>{s.location ?? '—'}</Td>
                  <Td>
                    <Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Active' : 'Inactive'}</Badge>
                  </Td>
                  {canManage && (
                    <Td align="right">
                      <Button variant="secondary" size="sm" disabled={busyId === s.id} onClick={() => toggleActive(s)}>
                        {busyId === s.id ? 'Working…' : s.active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </AppShell>
  );
}

function StationForm({ onDone }: { onDone: () => void }) {
  const api = useApi();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.stations.create({ name, code, location: location || undefined });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create station');
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Name">
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Kisumu 3" />
        </Field>
        <Field label="Code">
          <input style={inputStyle} value={code} onChange={(e) => setCode(e.target.value)} placeholder="KIS3" />
        </Field>
        <Field label="Location">
          <input style={inputStyle} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      <Button variant="primary" onClick={submit} disabled={busy || !name || !code} style={{ marginTop: 14 }}>
        {busy ? 'Creating…' : 'Create station'}
      </Button>
    </Card>
  );
}
