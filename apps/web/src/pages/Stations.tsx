import type { Station } from '@loyalty/shared';
import { Permission } from '@loyalty/shared';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { usePagedRows } from '../data/usePagedRows';
import { useStations } from '../data/useStations';
import { AppShell } from '../layout/AppShell';
import type { ExportColumn } from '../lib/exportTable';
import { ExportButtons } from '../ui/ExportButtons';
import { Icon } from '../ui/Icon';
import { Badge, Button, Card, Field, Modal, Pagination, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

const STATION_COLUMNS: ExportColumn<Station>[] = [
  { header: 'Name', value: (s) => s.name },
  { header: 'Code', value: (s) => s.code },
  { header: 'Location', value: (s) => s.location ?? '' },
  { header: 'Status', value: (s) => (s.active ? 'Active' : 'Inactive') },
];

export function Stations() {
  const api = useApi();
  const { hasPermission } = useAuth();
  const canManage = hasPermission(Permission.STATIONS_MANAGE);
  const { stations, refresh } = useStations();
  const { paged, page, pageCount, setPage } = usePagedRows(stations);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Station | null>(null);
  const [deleting, setDeleting] = useState<Station | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

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

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await api.stations.delete(deleting.id);
      setDeleting(null);
      refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete this station');
    } finally {
      setDeleteBusy(false);
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
        <div style={{ display: 'flex', gap: 10 }}>
          {canManage && (
            <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : 'Add station'}
            </Button>
          )}
          <div style={{ flex: 1 }} />
          <ExportButtons filename="stations" title="Stations" columns={STATION_COLUMNS} rows={stations} />
        </div>
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
              {paged.map((s) => (
                <Tr key={s.id}>
                  <Td>{s.name}</Td>
                  <Td>{s.code}</Td>
                  <Td>{s.location ?? '—'}</Td>
                  <Td>
                    <Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Active' : 'Inactive'}</Badge>
                  </Td>
                  {canManage && (
                    <Td align="right">
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Button variant="secondary" size="sm" onClick={() => setEditing(s)}>
                          Edit
                        </Button>
                        <Button variant="secondary" size="sm" disabled={busyId === s.id} onClick={() => toggleActive(s)}>
                          {busyId === s.id ? 'Working…' : s.active ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleting(s);
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                        >
                          <Icon name="trash" size={13} />
                          Delete
                        </Button>
                      </div>
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageCount={pageCount} onChange={setPage} totalLabel={`${stations.length} station(s)`} />
        </Card>
      </div>

      {editing && (
        <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <EditStationForm
            station={editing}
            onDone={() => {
              setEditing(null);
              refresh();
            }}
          />
        </Modal>
      )}

      {deleting && (
        <Modal title={`Delete ${deleting.name}?`} onClose={() => !deleteBusy && setDeleting(null)}>
          <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            This permanently deletes <strong>{deleting.name}</strong> ({deleting.code}). Only allowed if no customers, sales, attendants, or users still reference this station — otherwise, deactivate it instead.
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

function EditStationForm({ station, onDone }: { station: Station; onDone: () => void }) {
  const api = useApi();
  const [name, setName] = useState(station.name);
  const [location, setLocation] = useState(station.location ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.stations.update(station.id, { name, location: location || undefined });
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
        <Field label="Name" required>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Location">
          <input style={inputStyle} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <Button variant="primary" onClick={submit} disabled={busy || !name}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
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
        <Field label="Name" required>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Kisumu 3" />
        </Field>
        <Field label="Code" required>
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
