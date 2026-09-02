import type { ApkVersion } from '@loyalty/shared';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../data/client';
import { AppShell } from '../layout/AppShell';
import { formatNairobiDateTime } from '../lib/time';
import { Icon } from '../ui/Icon';
import { Badge, Button, Card, Field, Modal, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function ApkVersions() {
  const api = useApi();
  const [versions, setVersions] = useState<ApkVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ApkVersion | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    api.apkVersions
      .list()
      .then(setVersions)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load app versions'))
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(refresh, [refresh]);

  async function markRelease(version: ApkVersion) {
    setError(null);
    setBusyId(version.id);
    try {
      await api.apkVersions.markRelease(version.id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not mark ${version.versionName} as the release`);
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await api.apkVersions.delete(deleting.id);
      setDeleting(null);
      refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete this version');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <AppShell title="Android app" subtitle="Manage app builds and choose which one the /apk page serves">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
        {error && (
          <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12 }}>
            {error}
          </div>
        )}

        <div>
          <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'Add version'}
          </Button>
        </div>

        {showForm && (
          <UploadForm
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
                <Th>Version</Th>
                <Th>Size</Th>
                <Th>Uploaded by</Th>
                <Th>Uploaded</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <Tr key={v.id}>
                  <Td>
                    <div style={{ fontWeight: 700 }}>{v.versionName}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>code {v.versionCode}</div>
                  </Td>
                  <Td>{formatFileSize(v.fileSizeBytes)}</Td>
                  <Td>{v.uploadedByName}</Td>
                  <Td>{formatNairobiDateTime(v.createdAt)}</Td>
                  <Td>
                    <Badge tone={v.isRelease ? 'success' : 'neutral'}>{v.isRelease ? 'Released' : 'Not released'}</Badge>
                  </Td>
                  <Td align="right">
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {!v.isRelease && (
                        <Button variant="secondary" size="sm" disabled={busyId === v.id} onClick={() => markRelease(v)}>
                          {busyId === v.id ? 'Working…' : 'Mark as release'}
                        </Button>
                      )}
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={v.isRelease}
                        title={v.isRelease ? 'Mark a different version as the release before deleting this one' : undefined}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleting(v);
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
              {!loading && versions.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '14px', color: 'var(--color-text-secondary)' }}>
                    No versions uploaded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>
      </div>

      {deleting && (
        <Modal title={`Delete ${deleting.versionName}?`} onClose={() => !deleteBusy && setDeleting(null)}>
          <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            This permanently deletes the uploaded build for <strong>{deleting.versionName}</strong>. This cannot be undone.
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

function UploadForm({ onDone }: { onDone: () => void }) {
  const api = useApi();
  const [versionName, setVersionName] = useState('');
  const [versionCode, setVersionCode] = useState('');
  const [features, setFeatures] = useState('');
  const [fixes, setFixes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const versionCodeNum = Number(versionCode);
  const canSubmit = versionName.trim().length > 0 && Number.isInteger(versionCodeNum) && versionCodeNum > 0 && !!file;

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await api.apkVersions.create({
        versionName: versionName.trim(),
        versionCode: versionCodeNum,
        features: linesToList(features),
        fixes: linesToList(fixes),
        file,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload this version');
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
        <Field label="Version name" required>
          <input style={inputStyle} value={versionName} onChange={(e) => setVersionName(e.target.value)} placeholder="1.4.0" />
        </Field>
        <Field label="Version code" required>
          <input
            style={inputStyle}
            type="number"
            min={1}
            value={versionCode}
            onChange={(e) => setVersionCode(e.target.value)}
            placeholder="14"
          />
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <Field label="APK file" required>
          <input
            type="file"
            accept=".apk"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ fontSize: 13.5 }}
          />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Field label="New features">
          <textarea
            style={{ ...inputStyle, minHeight: 90, resize: 'vertical', fontFamily: 'var(--font-body)' }}
            value={features}
            onChange={(e) => setFeatures(e.target.value)}
            placeholder={'One per line'}
          />
        </Field>
        <Field label="Fixes">
          <textarea
            style={{ ...inputStyle, minHeight: 90, resize: 'vertical', fontFamily: 'var(--font-body)' }}
            value={fixes}
            onChange={(e) => setFixes(e.target.value)}
            placeholder={'One per line'}
          />
        </Field>
      </div>
      <Button variant="primary" onClick={submit} disabled={busy || !canSubmit} style={{ marginTop: 14 }}>
        {busy ? 'Uploading…' : 'Upload version'}
      </Button>
    </Card>
  );
}
