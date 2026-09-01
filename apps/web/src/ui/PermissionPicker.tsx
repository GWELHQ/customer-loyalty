import type { Permission } from '@loyalty/shared';
import { useMemo } from 'react';

function prettify(segment: string): string {
  return segment
    .split('_')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

function groupPermissions(permissions: Permission[]): Record<string, Permission[]> {
  const groups: Record<string, Permission[]> = {};
  for (const permission of permissions) {
    const [group] = permission.split(':');
    (groups[group!] ??= []).push(permission);
  }
  return groups;
}

/** Grouped checkbox list for building a role's permission set — used by RolesAdmin.tsx. */
export function PermissionPicker({
  allPermissions,
  selected,
  onChange,
}: {
  allPermissions: Permission[];
  selected: Permission[];
  onChange: (next: Permission[]) => void;
}) {
  const groups = useMemo(() => groupPermissions(allPermissions), [allPermissions]);
  const selectedSet = new Set(selected);

  function toggle(permission: Permission) {
    const next = new Set(selectedSet);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    onChange([...next]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--color-border)', borderRadius: 8, padding: 12, maxHeight: 340, overflowY: 'auto' }}>
      {Object.entries(groups).map(([group, groupPermissions]) => (
        <div key={group}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
            {prettify(group)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {groupPermissions.map((permission) => (
              <label key={permission} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
                <input type="checkbox" checked={selectedSet.has(permission)} onChange={() => toggle(permission)} />
                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{permission}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
