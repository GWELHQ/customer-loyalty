import type { SalesReportGroupBy } from '@loyalty/shared';
import { useState } from 'react';
import { useApi } from '../data/client';
import { Button, Field, Modal, inputStyle } from './primitives';

function parseEmails(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * "Send via email" for the sales report — mirrors PromptModal.tsx's
 * shape (Modal + Field + local state, confirm/cancel) but with several
 * fields instead of one. Sends from the system mailbox with Reply-To
 * set to the sender (see apps/api/src/reports/reports.service.ts's
 * emailSalesReport) — not true delegated send-as.
 */
export function SendReportEmailModal({
  reportParams,
  onClose,
}: {
  reportParams: { stationId?: string; preset?: string; from?: string; to?: string; groupBy?: SalesReportGroupBy };
  onClose: () => void;
}) {
  const api = useApi();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string[] | null>(null);

  const recipients = parseEmails(to);

  async function submit() {
    if (recipients.length === 0) {
      setError('Enter at least one recipient email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.reports.emailSales({
        ...reportParams,
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
    <Modal title="Send report by email" onClose={onClose}>
      {sentTo ? (
        <div>
          <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)' }}>
            Sent to {sentTo.join(', ')}.
          </div>
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
            <Field label="To" required>
              <input
                autoFocus
                style={inputStyle}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="name@example.com, name2@example.com"
              />
            </Field>
            <Field label="CC">
              <input style={inputStyle} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Subject">
              <input
                style={inputStyle}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Leave blank to use a default subject"
              />
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
            Sent from Green Wells' system address — replies go to you directly. The report is included in the email and attached as XLSX and PDF.
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
