import type { CashbackTrendReport, CashbackTrendSettings } from '@loyalty/shared';
import { Permission } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { Button, Card, CardHeader, Field, Modal, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

function parseEmails(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatKsh(value: number | null): string {
  if (value === null) return '';
  return value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Year-to-date paid-out cashback by station (January through the latest
 * fully disbursed month) with the trend chart. The chart is the same PNG the
 * server embeds in the emailed report, so what's seen here is what gets sent.
 */
export function CashbackTrendSection() {
  const api = useApi();
  const { hasPermission } = useAuth();
  const canEditSettings = hasPermission(Permission.DISBURSEMENT_SETTINGS_MANAGE);

  const [report, setReport] = useState<CashbackTrendReport | null>(null);
  const [settings, setSettings] = useState<CashbackTrendSettings | null>(null);
  const [chartUrl, setChartUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  const [editingRecipients, setEditingRecipients] = useState(false);

  function loadSettings() {
    api.cashbackTrend.settings().then(setSettings).catch(() => setSettings(null));
  }

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    api.cashbackTrend
      .report()
      .then(async (r) => {
        if (cancelled) return;
        setReport(r);
        if (r.rows.length > 0) {
          const { blob } = await api.cashbackTrend.chart();
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setChartUrl(objectUrl);
        }
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : 'Could not load the cashback trend'));
    loadSettings();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  async function download(format: 'xlsx' | 'pdf') {
    setActionError(null);
    setBusy(format);
    try {
      const { blob, filename } = await api.cashbackTrend.download(format);
      saveBlob(blob, filename ?? `cashback-trend.${format}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not export this report');
    } finally {
      setBusy(null);
    }
  }

  if (loadError) return null;
  const hasData = report !== null && report.months.length > 0;

  return (
    <Card padding={0}>
      <div style={{ padding: 16, borderBottom: '1px solid var(--color-border)' }}>
        <CardHeader
          title="Paid-out cashback trend"
          subtitle={
            hasData
              ? `Cashback paid out to customers, ${report.monthLabels[0]} to ${report.monthLabels[report.monthLabels.length - 1]} ${report.year}. A month appears once all stations' disbursements are complete.`
              : 'Appears once a month has been fully disbursed.'
          }
          right={
            hasData ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {actionError && <span style={{ fontSize: 12, color: 'var(--color-danger)' }}>{actionError}</span>}
                <Button variant="secondary" size="sm" onClick={() => download('xlsx')} disabled={busy !== null}>
                  {busy === 'xlsx' ? 'Exporting…' : 'Export XLSX'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => download('pdf')} disabled={busy !== null}>
                  {busy === 'pdf' ? 'Exporting…' : 'Export PDF'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setShowEmail(true)}>
                  Send email
                </Button>
              </div>
            ) : undefined
          }
        />
      </div>

      {hasData && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>Station</Th>
                  {report.monthLabels.map((l) => (
                    <Th key={l} align="right">
                      {l}
                    </Th>
                  ))}
                  <Th align="right">Grand Total</Th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <Tr key={r.stationId}>
                    <Td>
                      <strong>{r.stationName}</strong>
                    </Td>
                    {r.values.map((v, i) => (
                      <Td key={report.months[i]} align="right">
                        {formatKsh(v)}
                      </Td>
                    ))}
                    <Td align="right">
                      <strong>{formatKsh(r.total)}</strong>
                    </Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <Tr style={{ background: 'var(--color-surface-sunken)', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>
                  <Td>Total</Td>
                  {report.monthTotals.map((v, i) => (
                    <Td key={report.months[i]} align="right">
                      {formatKsh(v)}
                    </Td>
                  ))}
                  <Td align="right">{formatKsh(report.grandTotal)}</Td>
                </Tr>
              </tfoot>
            </Table>
          </div>
          {chartUrl && (
            <div style={{ padding: 16 }}>
              <img src={chartUrl} alt="Paid-out cashback trend by station" style={{ width: '100%', maxWidth: 900, display: 'block', margin: '0 auto' }} />
            </div>
          )}
        </>
      )}

      {settings && (
        <div style={{ padding: 16, borderTop: '1px solid var(--color-border)', fontSize: 13 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Emailed automatically when a month's disbursement completes, to:</span>
            <strong>{settings.autoRecipients.length > 0 ? settings.autoRecipients.join(', ') : 'nobody yet'}</strong>
            {canEditSettings && !editingRecipients && (
              <Button variant="secondary" size="sm" onClick={() => setEditingRecipients(true)}>
                Edit
              </Button>
            )}
          </div>
          {editingRecipients && (
            <AutoRecipientsForm
              current={settings.autoRecipients}
              onCancel={() => setEditingRecipients(false)}
              onSaved={() => {
                setEditingRecipients(false);
                loadSettings();
              }}
            />
          )}
        </div>
      )}

      {showEmail && <EmailTrendModal autoRecipients={settings?.autoRecipients ?? []} onClose={() => setShowEmail(false)} />}
    </Card>
  );
}

function AutoRecipientsForm({ current, onCancel, onSaved }: { current: string[]; onCancel: () => void; onSaved: () => void }) {
  const api = useApi();
  const [value, setValue] = useState(current.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.cashbackTrend.updateSettings(parseEmails(value));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the recipients');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
      {error && <div style={{ fontSize: 13, color: 'var(--color-danger)' }}>{error}</div>}
      <input
        style={inputStyle}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="name@example.com, name2@example.com"
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" size="sm" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Leaving "To" blank sends to the automatic recipients, which are shown as its placeholder. */
function EmailTrendModal({ autoRecipients, onClose }: { autoRecipients: string[]; onClose: () => void }) {
  const api = useApi();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string[] | null>(null);

  const recipients = parseEmails(to).length > 0 ? parseEmails(to) : autoRecipients;

  async function submit() {
    if (recipients.length === 0) {
      setError('Enter at least one recipient email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.cashbackTrend.email({
        recipients,
        cc: parseEmails(cc),
        subject: subject.trim() || undefined,
        body: body.trim() || undefined,
      });
      if (!result.success) {
        setError(result.errorReason || 'Could not send this email');
        return;
      }
      setSentTo(recipients);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send this email');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Send cashback trend by email" onClose={onClose}>
      {sentTo ? (
        <div>
          <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)' }}>Sent to {sentTo.join(', ')}.</div>
          <Button variant="primary" size="sm" onClick={onClose} style={{ marginTop: 14 }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="To (comma-separated)">
              <input
                autoFocus
                style={inputStyle}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder={autoRecipients.length > 0 ? autoRecipients.join(', ') : 'name@example.com, name2@example.com'}
              />
            </Field>
            <Field label="CC">
              <input style={inputStyle} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Subject">
              <input style={inputStyle} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Leave blank to use a default subject" />
            </Field>
            <Field label="Message">
              <textarea
                style={{ ...inputStyle, minHeight: 84, resize: 'vertical', fontFamily: 'var(--font-body)' }}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Leave blank to use a default message"
              />
            </Field>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Leave "To" blank to send to the automatic recipients. The table and chart are in the email body, with XLSX and PDF attached. Replies go to you.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Button variant="primary" size="sm" onClick={submit} disabled={busy || recipients.length === 0}>
              {busy ? 'Sending…' : 'Send'}
            </Button>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
