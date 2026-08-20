import type { Station, User } from '@loyalty/shared';
import { Role, UserStatus } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useApi } from '../data/client';
import { useStations } from '../data/useStations';
import { AppShell } from '../layout/AppShell';
import { Badge, Button, Card, Field, Modal, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: 'Admin',
  [Role.CHAIRMAN]: 'Chairman',
  [Role.FINANCE]: 'Finance',
  [Role.RTSM]: 'RTSM',
  [Role.STATION_SUPERVISOR]: 'Station Supervisor',
  [Role.ATTENDANT]: 'Attendant',
  [Role.EXEC_VIEWER]: 'Exec Viewer',
};

const ASSIGNABLE_ROLES = [Role.ADMIN, Role.CHAIRMAN, Role.FINANCE, Role.RTSM, Role.STATION_SUPERVISOR, Role.EXEC_VIEWER];

export function Users() {
  const api = useApi();
  const [users, setUsers] = useState<User[]>([]);
  const { stations } = useStations();
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    api.users.list().then(setUsers);
  }
  useEffect(reload, [api]);

  async function toggleStatus(user: User) {
    setError(null);
    setBusyId(user.id);
    try {
      await api.users.setStatus(user.id, user.status === UserStatus.ACTIVE ? UserStatus.INACTIVE : UserStatus.ACTIVE);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not update ${user.fullName}'s status`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell title="Users" subtitle="Admin, Chairman, Finance, RTSM, Station Supervisor and Exec Viewer accounts (Microsoft login)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12 }}>
            {error}
          </div>
        )}
        <div>
          <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'Add user'}
          </Button>
        </div>
        {showForm && (
          <UserForm
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
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Station</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <Tr key={u.id}>
                  <Td>{u.fullName}</Td>
                  <Td>{u.email}</Td>
                  <Td>{ROLE_LABELS[u.role]}</Td>
                  <Td>{stations.find((s) => s.id === u.assignedStationId)?.name ?? '—'}</Td>
                  <Td>
                    <Badge tone={u.status === UserStatus.ACTIVE ? 'success' : 'neutral'}>{u.status}</Badge>
                  </Td>
                  <Td align="right">
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button variant="secondary" size="sm" onClick={() => setEditingUser(u)}>
                        Edit role
                      </Button>
                      <Button variant="secondary" size="sm" disabled={busyId === u.id} onClick={() => toggleStatus(u)}>
                        {busyId === u.id ? 'Working…' : u.status === UserStatus.ACTIVE ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      {editingUser && (
        <EditUserModal
          user={editingUser}
          stations={stations}
          onClose={() => setEditingUser(null)}
          onSaved={() => {
            setEditingUser(null);
            reload();
          }}
        />
      )}
    </AppShell>
  );
}

function EditUserModal({
  user,
  stations,
  onClose,
  onSaved,
}: {
  user: User;
  stations: Station[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const [role, setRole] = useState<Role>(user.role);
  const [assignedStationId, setAssignedStationId] = useState(user.assignedStationId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await api.users.update(user.id, {
        role,
        assignedStationId: role === Role.STATION_SUPERVISOR ? assignedStationId : undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this user');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Edit role — ${user.fullName}`} onClose={onClose}>
      {error && (
        <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <Field label="Role">
        <select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
      {role === Role.STATION_SUPERVISOR && (
        <div style={{ marginTop: 12 }}>
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
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <Button
          variant="primary"
          onClick={submit}
          disabled={busy || (role === Role.STATION_SUPERVISOR && !assignedStationId)}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

function UserForm({ stations, onDone }: { stations: Station[]; onDone: () => void }) {
  const api = useApi();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(Role.RTSM);
  const [assignedStationId, setAssignedStationId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await api.users.create({
        fullName,
        email,
        role,
        assignedStationId: role === Role.STATION_SUPERVISOR ? assignedStationId : undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create user');
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
        <Field label="Work email">
          <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@greenwells.co.ke" />
        </Field>
        <Field label="Role">
          <select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        {role === Role.STATION_SUPERVISOR && (
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
        )}
      </div>
      <Button
        variant="primary"
        onClick={submit}
        disabled={busy || !fullName || !email || (role === Role.STATION_SUPERVISOR && !assignedStationId)}
        style={{ marginTop: 14 }}
      >
        {busy ? 'Creating…' : 'Create user'}
      </Button>
    </Card>
  );
}
