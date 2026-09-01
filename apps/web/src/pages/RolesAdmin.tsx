import { Permission, type RoleDefinition } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { usePagedRows } from '../data/usePagedRows';
import { useTextFilter } from '../data/useTextFilter';
import { useRoles } from '../data/useRoles';
import { AppShell } from '../layout/AppShell';
import { Icon } from '../ui/Icon';
import { PermissionPicker } from '../ui/PermissionPicker';
import { Badge, Button, Card, Field, Modal, Pagination, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

export function RolesAdmin() {
  const api = useApi();
  const { hasPermission } = useAuth();
  const canManage = hasPermission(Permission.RBAC_MANAGE);
  const { roles, refresh } = useRoles();
  const { search, setSearch, filtered } = useTextFilter(roles, (r) => `${r.displayName} ${r.description}`);
  const { paged, page, pageCount, setPage } = usePagedRows(filtered);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RoleDefinition | null>(null);
  const [deleting, setDeleting] = useState<RoleDefinition | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await api.rbac.deleteRole(deleting.key);
      setDeleting(null);
      refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete this role');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <AppShell title="Roles" subtitle="Create roles and assign permissions to them — Admin only">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {canManage && (
            <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : 'New custom role'}
            </Button>
          )}
          <input
            placeholder="Search roles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, maxWidth: 240 }}
          />
        </div>
        {showForm && (
          <RoleFormCard
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
                <Th>Role</Th>
                <Th>Description</Th>
                <Th>Permissions</Th>
                {canManage && <Th align="right">Actions</Th>}
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                <Tr key={r.key}>
                  <Td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <strong>{r.displayName}</strong>
                      {!r.isSystem && <Badge tone="info">Custom</Badge>}
                    </div>
                  </Td>
                  <Td>{r.description}</Td>
                  <Td>{r.permissions.length}</Td>
                  {canManage && (
                    <Td align="right">
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Button variant="secondary" size="sm" onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                        {!r.isSystem && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleting(r);
                            }}
                            style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                          >
                            <Icon name="trash" size={13} />
                            Delete
                          </Button>
                        )}
                      </div>
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageCount={pageCount} onChange={setPage} totalLabel={`${filtered.length} role(s)`} />
        </Card>
      </div>

      {editing && (
        <Modal title={`Edit "${editing.displayName}"`} onClose={() => setEditing(null)}>
          <RoleForm
            role={editing}
            onDone={() => {
              setEditing(null);
              refresh();
            }}
          />
        </Modal>
      )}

      {deleting && (
        <Modal title={`Delete "${deleting.displayName}"?`} onClose={() => !deleteBusy && setDeleting(null)}>
          <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            This permanently removes the <strong>{deleting.displayName}</strong> role. Blocked if any user still has this role assigned — reassign them first.
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

function RoleFormCard({ onDone }: { onDone: () => void }) {
  return (
    <Card>
      <RoleForm onDone={onDone} />
    </Card>
  );
}

function RoleForm({ role, onDone }: { role?: RoleDefinition; onDone: () => void }) {
  const api = useApi();
  const isEdit = !!role;
  const [key, setKey] = useState(role?.key ?? '');
  const [displayName, setDisplayName] = useState(role?.displayName ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [permissions, setPermissions] = useState<Permission[]>(role?.permissions ?? []);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.rbac.listPermissions().then(setAllPermissions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    setError(null);
    if (!isEdit && !/^[a-z][a-z0-9_]{2,63}$/.test(key)) {
      setError('Key must be lowercase snake_case, 3-64 characters, starting with a letter.');
      return;
    }
    if (!displayName.trim()) {
      setError('Display name is required.');
      return;
    }
    if (permissions.length === 0) {
      setError('Select at least one permission.');
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        await api.rbac.updateRole(role.key, { displayName: displayName.trim(), description: description.trim(), permissions });
      } else {
        await api.rbac.createRole({ key: key.trim(), displayName: displayName.trim(), description: description.trim(), permissions });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this role');
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
        {!isEdit && (
          <Field label="Key" required>
            <input
              style={inputStyle}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="regional_auditor"
            />
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3 }}>
              Lowercase snake_case — cannot be changed later.
            </div>
          </Field>
        )}
        <Field label="Display name" required>
          <input style={inputStyle} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Description">
          <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Permissions" required>
          <PermissionPicker allPermissions={allPermissions} selected={permissions} onChange={setPermissions} />
        </Field>
      </div>
      <Button variant="primary" onClick={submit} disabled={busy} style={{ marginTop: 14 }}>
        {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create role'}
      </Button>
    </div>
  );
}
