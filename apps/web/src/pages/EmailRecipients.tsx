import type { AutomaticEmailRecipient, SystemEmailRecipientsView } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useApi } from '../data/client';
import { AppShell } from '../layout/AppShell';
import { Badge, Button, Card, Field, inputStyle } from '../ui/primitives';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmails(raw: string): string[] {
  return [...new Set(raw.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Admin/Super Admin settings page listing every email the system sends on
 * its own: who gets it automatically (read-only, worked out from current
 * users' roles and other settings) and extra To/CC addresses added on top.
 */
export function EmailRecipients() {
  const api = useApi();
  const [rows, setRows] = useState<SystemEmailRecipientsView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  function load() {
    api.emailRecipients
      .list()
      .then((r) => {
        setRows(r);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not load the email recipients'));
  }

  useEffect(load, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppShell title="Email recipients" subtitle="Who gets each email the system sends, and who else to include">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
          Each email always goes to its <strong>automatic recipients</strong>, worked out from users' roles when it is sent. Extra
          addresses you add are included on top of them. They never replace the automatic recipients. If nobody is due an email
          automatically, it still goes to the extra To recipients.
        </div>
        {loadError && (
          <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12 }}>
            {loadError}
          </div>
        )}
        {rows === null && !loadError && <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</div>}
        {rows?.map((row) => <EmailTypeCard key={row.type} row={row} onSaved={load} />)}
      </div>
    </AppShell>
  );
}

function EmailTypeCard({ row, onSaved }: { row: SystemEmailRecipientsView; onSaved: () => void }) {
  const api = useApi();
  const [editing, setEditing] = useState(false);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setTo(row.extra.to.join(', '));
    setCc(row.extra.cc.join(', '));
    setError(null);
    setEditing(true);
  }

  async function save() {
    const toList = parseEmails(to);
    const ccList = parseEmails(cc);
    const invalid = [...toList, ...ccList].filter((e) => !EMAIL_PATTERN.test(e));
    if (invalid.length > 0) {
      setError(`Not a valid email address: ${invalid.join(', ')}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.emailRecipients.update(row.type, { to: toList, cc: ccList });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the recipients');
    } finally {
      setBusy(false);
    }
  }

  const hasExtras = row.extra.to.length > 0 || row.extra.cc.length > 0;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{row.label}</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 3 }}>{row.trigger}</div>
        </div>
        {!editing && (
          <Button variant="secondary" size="sm" onClick={startEditing}>
            {hasExtras ? 'Edit extra recipients' : 'Add recipients'}
          </Button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 14 }}>
        <section>
          <SectionLabel>Automatic recipients</SectionLabel>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>{row.automaticRule}</div>
          <RecipientLine label="To" recipients={row.automatic.to} emptyText="Nobody right now" />
          {row.automatic.cc.length > 0 && <RecipientLine label="CC" recipients={row.automatic.cc} />}
        </section>

        <section>
          <SectionLabel>Extra recipients</SectionLabel>
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {error && <div style={{ fontSize: 12.5, color: 'var(--color-danger)' }}>{error}</div>}
              <Field label="To (comma-separated)">
                <input autoFocus style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" />
              </Field>
              <Field label="CC (comma-separated)">
                <input style={inputStyle} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="name@example.com" />
              </Field>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="primary" size="sm" onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : hasExtras ? (
            <>
              <RecipientLine label="To" recipients={row.extra.to.map((email) => ({ email }))} emptyText="None" />
              <RecipientLine label="CC" recipients={row.extra.cc.map((email) => ({ email }))} emptyText="None" />
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>None added.</div>
          )}
        </section>
      </div>
    </Card>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
      {children}
    </div>
  );
}

function RecipientLine({ label, recipients, emptyText }: { label: string; recipients: AutomaticEmailRecipient[]; emptyText?: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', width: 24, flexShrink: 0, paddingTop: 4 }}>{label}</span>
      {recipients.length === 0 ? (
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)', paddingTop: 3 }}>{emptyText}</span>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
          {recipients.map((r) => (
            <span key={r.email} title={r.note ? `${r.email} — ${r.note}` : r.email} style={{ maxWidth: '100%' }}>
              <Badge tone="neutral">
                {r.name ? `${r.name} · ${r.email}` : r.email}
                {r.note ? ` (${r.note})` : ''}
              </Badge>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
