import type { PriceReminderSetting, ProductPrice } from '@loyalty/shared';
import { Permission, Product } from '@loyalty/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useRealtimeRefresh } from '../data/realtime';
import { AppShell } from '../layout/AppShell';
import { Icon } from '../ui/Icon';
import { Badge, Button, Card, Field, inputStyle } from '../ui/primitives';

export function Prices() {
  const api = useApi();
  const { hasPermission } = useAuth();
  const canManage = hasPermission(Permission.PRICES_MANAGE);
  const [current, setCurrent] = useState<Record<Product, ProductPrice | null> | null>(null);
  const [reminders, setReminders] = useState<PriceReminderSetting | null>(null);
  const [product, setProduct] = useState<Product>(Product.PMS);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [pricePerLitre, setPricePerLitre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingReminders, setEditingReminders] = useState(false);

  function reload() {
    api.prices.current().then(setCurrent);
    api.prices.reminderSettings().then(setReminders);
  }
  useEffect(reload, [api]);
  useRealtimeRefresh(['productPrices'], reload);

  async function publish() {
    setError(null);
    setBusy(true);
    try {
      await api.prices.create({ product, pricePerLitre: Number(pricePerLitre), effectiveFrom: new Date(effectiveFrom).toISOString() });
      setPricePerLitre('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish price');
    } finally {
      setBusy(false);
    }
  }

  const missing = current ? Object.values(Product).filter((p) => !current[p]) : [];

  return (
    <AppShell title="Fuel prices" subtitle="PMS and AGO price per litre, with a full audit history">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1100 }}>
        {missing.length > 0 && (
          <div style={{ background: 'var(--color-danger-tint)', border: '1px solid var(--gw-red-500)', borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Icon name="alertTriangle" size={19} color="var(--color-danger)" />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                {missing.join(' and ')} {missing.length > 1 ? 'have' : 'has'} no active price set
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 3 }}>
                Attendants cannot record a sale for a product with no active price — every sale for it is blocked at the pump.
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {Object.values(Product).map((p) => {
            const price = current?.[p];
            return (
              <Card key={p}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17 }}>
                      {p === Product.PMS ? 'Petrol' : 'Diesel'}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{p}</div>
                  </div>
                  <Badge tone={price ? 'success' : 'danger'}>{price ? 'Active' : 'Not set'}</Badge>
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 38, marginTop: 12 }}>
                  {price ? `KSh ${price.pricePerLitre}` : '—'}
                </div>
                {price && (
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    per litre · effective {new Date(price.effectiveFrom).toLocaleDateString('en-KE')}
                  </div>
                )}
                {price && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--color-border)', fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                    <div>Set by {price.createdByName}</div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {canManage && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, alignItems: 'start' }}>
            <Card>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>Set next price</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 3 }}>
                A new price never replaces the old one. Sales keep the price that was live when they happened.
              </div>
              {error && (
                <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12, marginTop: 12 }}>
                  {error}
                </div>
              )}
              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Product">
                  <select style={inputStyle} value={product} onChange={(e) => setProduct(e.target.value as Product)}>
                    {Object.values(Product).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Effective from">
                  <input type="date" style={inputStyle} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                </Field>
                <div style={{ gridColumn: 'span 2' }}>
                  <Field label="Price per litre (KSh)">
                    <input type="number" step="0.01" style={inputStyle} value={pricePerLitre} onChange={(e) => setPricePerLitre(e.target.value)} placeholder="226.40" />
                  </Field>
                </div>
              </div>
              <Button variant="primary" onClick={publish} disabled={busy || !pricePerLitre || !effectiveFrom} style={{ marginTop: 16 }}>
                {busy ? 'Publishing…' : 'Publish price'}
              </Button>
            </Card>

            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>Monthly price reminder</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 3 }}>
                    An email goes out before the monthly change so prices are never missed.
                  </div>
                </div>
                {reminders && !editingReminders && (
                  <Button variant="secondary" size="sm" onClick={() => setEditingReminders(true)}>
                    Edit
                  </Button>
                )}
              </div>
              {reminders && !editingReminders && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
                  <Row label="Reminder">
                    <Badge tone={reminders.enabled ? 'success' : 'neutral'}>{reminders.enabled ? 'On' : 'Off'}</Badge>
                  </Row>
                  <Row label="Sends on">
                    <strong>
                      {reminders.dayOfMonth}
                      {ordinal(reminders.dayOfMonth)} of each month, {String(reminders.hourOfDay).padStart(2, '0')}:00
                    </strong>
                  </Row>
                  <Row label="Timezone">
                    <strong>{reminders.timezone}</strong>
                  </Row>
                  <Row label="Next reminder">
                    <strong>{new Date(reminders.nextReminderAt).toLocaleString('en-KE')}</strong>
                  </Row>
                  <div>
                    <div style={{ color: 'var(--color-text-secondary)', marginBottom: 6 }}>Recipients</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {reminders.recipientEmails.length === 0 && <span style={{ color: 'var(--color-text-muted)' }}>None configured</span>}
                      {reminders.recipientEmails.map((e) => (
                        <span key={e} style={{ fontSize: 12, background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)', borderRadius: 999, padding: '4px 10px' }}>
                          {e}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {reminders && editingReminders && (
                <ReminderSettingsForm
                  settings={reminders}
                  onCancel={() => setEditingReminders(false)}
                  onSaved={() => {
                    setEditingReminders(false);
                    reload();
                  }}
                />
              )}
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ReminderSettingsForm({
  settings,
  onCancel,
  onSaved,
}: {
  settings: PriceReminderSetting;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [dayOfMonth, setDayOfMonth] = useState(String(settings.dayOfMonth));
  const [hourOfDay, setHourOfDay] = useState(String(settings.hourOfDay));
  const [emails, setEmails] = useState(settings.recipientEmails.join(', '));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    const day = Number(dayOfMonth);
    const hour = Number(hourOfDay);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      setError('Day of month must be between 1 and 28 (every month has at least 28 days).');
      return;
    }
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      setError('Hour must be between 0 and 23.');
      return;
    }
    const recipientEmails = emails
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    setBusy(true);
    try {
      await api.prices.updateReminderSettings({ enabled, dayOfMonth: day, hourOfDay: hour, recipientEmails });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save reminder settings');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12 }}>
          {error}
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Reminder enabled
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Day of month (1–28)">
          <input
            type="number"
            min={1}
            max={28}
            style={inputStyle}
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(e.target.value)}
          />
        </Field>
        <Field label="Hour (0–23, Africa/Nairobi)">
          <input
            type="number"
            min={0}
            max={23}
            style={inputStyle}
            value={hourOfDay}
            onChange={(e) => setHourOfDay(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Recipient emails (comma-separated)">
        <input style={inputStyle} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="finance@greenwellsenergies.co.ke, chairman@greenwellsenergies.co.ke" />
      </Field>
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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      {children}
    </div>
  );
}

function ordinal(n: number): string {
  if (n % 10 === 1 && n !== 11) return 'st';
  if (n % 10 === 2 && n !== 12) return 'nd';
  if (n % 10 === 3 && n !== 13) return 'rd';
  return 'th';
}
