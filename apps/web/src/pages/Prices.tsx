import type { CustomerInactivitySettings, DisbursementSettings, PriceReminderSetting, ProductPrice, Station } from '@loyalty/shared';
import { Permission, Product } from '@loyalty/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useRealtimeRefresh } from '../data/realtime';
import { useStations } from '../data/useStations';
import { AppShell } from '../layout/AppShell';
import { formatNairobiDate, formatNairobiDateTime } from '../lib/time';
import { Icon } from '../ui/Icon';
import { Badge, Button, Card, Field, inputStyle } from '../ui/primitives';

type AllStationsCurrent = Array<{ station: Station; prices: Record<Product, ProductPrice | null> }>;

export function Prices() {
  const api = useApi();
  const { user, hasPermission } = useAuth();
  const { stations } = useStations();
  const canManage = hasPermission(Permission.PRICES_MANAGE);
  const canManageDisbursementSettings = hasPermission(Permission.DISBURSEMENT_SETTINGS_MANAGE);
  const canManageInactivitySettings = hasPermission(Permission.CUSTOMER_INACTIVITY_SETTINGS_MANAGE);
  const [stationId, setStationId] = useState(user?.assignedStationId ?? '');
  const [current, setCurrent] = useState<Record<Product, ProductPrice | null> | null>(null);
  const [allStationsCurrent, setAllStationsCurrent] = useState<AllStationsCurrent | null>(null);
  const [reminders, setReminders] = useState<PriceReminderSetting | null>(null);
  const [disbursementSettings, setDisbursementSettings] = useState<DisbursementSettings | null>(null);
  const [inactivitySettings, setInactivitySettings] = useState<CustomerInactivitySettings | null>(null);
  const [product, setProduct] = useState<Product>(Product.PMS);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [pricePerLitre, setPricePerLitre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingReminders, setEditingReminders] = useState(false);
  const [editingDisbursementSettings, setEditingDisbursementSettings] = useState(false);
  const [editingInactivitySettings, setEditingInactivitySettings] = useState(false);

  // Roles without an assigned station (Admin/RTSM/Chairman/Finance Approver)
  // default to the first station once the list loads, rather than querying
  // with an empty stationId.
  useEffect(() => {
    if (!stationId && stations.length > 0) setStationId(stations[0]!.id);
  }, [stationId, stations]);

  function reload() {
    if (stationId) {
      api.prices.current(stationId).then((res) => setCurrent(res as Record<Product, ProductPrice | null>));
    }
    api.prices.current().then((res) => setAllStationsCurrent(res as AllStationsCurrent));
    api.prices.reminderSettings().then(setReminders);
    if (canManageDisbursementSettings) api.disbursementSettings.get().then(setDisbursementSettings);
    if (canManageInactivitySettings) api.customerInactivitySettings.get().then(setInactivitySettings);
  }
  useEffect(reload, [api, stationId]);
  useRealtimeRefresh(['productPrices'], reload);

  async function publish() {
    setError(null);
    if (!stationId) {
      setError('Select a station first.');
      return;
    }
    setBusy(true);
    try {
      await api.prices.create({
        stationId,
        product,
        pricePerLitre: Number(pricePerLitre),
        effectiveFrom: new Date(effectiveFrom).toISOString(),
      });
      setPricePerLitre('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish price');
    } finally {
      setBusy(false);
    }
  }

  const missingByStation = (allStationsCurrent ?? []).flatMap(({ station, prices }) =>
    Object.values(Product)
      .filter((p) => !prices[p])
      .map((p) => `${station.name} has no ${p} price set`),
  );

  return (
    <AppShell title="Fuel prices" subtitle="PMS and AGO price per litre, with a full audit history">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1100 }}>
        {missingByStation.length > 0 && (
          <div style={{ background: 'var(--color-danger-tint)', border: '1px solid var(--gw-red-500)', borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Icon name="alertTriangle" size={19} color="var(--color-danger)" />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{missingByStation.join(', ')}</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 3 }}>
                Service assistants cannot record a sale for a product with no active price at their station — every sale for it is blocked at the pump.
              </div>
            </div>
          </div>
        )}

        <Card padding={16}>
          <Field label="Station">
            <select style={inputStyle} value={stationId} onChange={(e) => setStationId(e.target.value)}>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </Card>

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
                    per litre · effective {formatNairobiDate(price.effectiveFrom)}
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
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>
                Set next price — {stations.find((s) => s.id === stationId)?.name ?? 'select a station above'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 3 }}>
                Applies only to the station selected above. A new price never replaces the old one — sales keep the price that was live when they happened.
              </div>
              {error && (
                <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12, marginTop: 12 }}>
                  {error}
                </div>
              )}
              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Product" required>
                  <select style={inputStyle} value={product} onChange={(e) => setProduct(e.target.value as Product)}>
                    {Object.values(Product).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Effective from" required>
                  <input type="date" style={inputStyle} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                </Field>
                <div style={{ gridColumn: 'span 2' }}>
                  <Field label="Price per litre (KSh)" required>
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
                    <strong>{formatNairobiDateTime(reminders.nextReminderAt)}</strong>
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

        {(canManageDisbursementSettings || canManageInactivitySettings) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
            {canManageDisbursementSettings && (
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>Minimum disbursement</div>
                    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 3 }}>
                      Customers below this amount aren't paid out — their cashback carries forward and is re-checked next cycle.
                    </div>
                  </div>
                  {disbursementSettings && !editingDisbursementSettings && (
                    <Button variant="secondary" size="sm" onClick={() => setEditingDisbursementSettings(true)}>
                      Edit
                    </Button>
                  )}
                </div>
                {disbursementSettings && !editingDisbursementSettings && (
                  <div style={{ marginTop: 14, fontSize: 13 }}>
                    <Row label="Minimum amount">
                      <strong>KSh {disbursementSettings.minDisbursementAmount}</strong>
                    </Row>
                  </div>
                )}
                {disbursementSettings && editingDisbursementSettings && (
                  <DisbursementSettingsForm
                    settings={disbursementSettings}
                    onCancel={() => setEditingDisbursementSettings(false)}
                    onSaved={() => {
                      setEditingDisbursementSettings(false);
                      reload();
                    }}
                  />
                )}
              </Card>
            )}

            {canManageInactivitySettings && (
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>Customer inactivity reset</div>
                    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 3 }}>
                      An inactive customer gets an SMS notice, then their cashback resets if inactivity continues.
                    </div>
                  </div>
                  {inactivitySettings && !editingInactivitySettings && (
                    <Button variant="secondary" size="sm" onClick={() => setEditingInactivitySettings(true)}>
                      Edit
                    </Button>
                  )}
                </div>
                {inactivitySettings && !editingInactivitySettings && (
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
                    <Row label="Notice after">
                      <strong>{inactivitySettings.noticeAfterDays} days inactive</strong>
                    </Row>
                    <Row label="Reset after notice">
                      <strong>{inactivitySettings.resetAfterAdditionalDays} more days</strong>
                    </Row>
                  </div>
                )}
                {inactivitySettings && editingInactivitySettings && (
                  <CustomerInactivitySettingsForm
                    settings={inactivitySettings}
                    onCancel={() => setEditingInactivitySettings(false)}
                    onSaved={() => {
                      setEditingInactivitySettings(false);
                      reload();
                    }}
                  />
                )}
              </Card>
            )}
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
        <Field label="Day of month (1–28)" required>
          <input
            type="number"
            min={1}
            max={28}
            style={inputStyle}
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(e.target.value)}
          />
        </Field>
        <Field label="Hour (0–23, Africa/Nairobi)" required>
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

function DisbursementSettingsForm({
  settings,
  onCancel,
  onSaved,
}: {
  settings: DisbursementSettings;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const [minDisbursementAmount, setMinDisbursementAmount] = useState(String(settings.minDisbursementAmount));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    const amount = Number(minDisbursementAmount);
    if (!Number.isInteger(amount) || amount < 0) {
      setError('Minimum amount must be a whole number, 0 or greater.');
      return;
    }
    setBusy(true);
    try {
      await api.disbursementSettings.update({ minDisbursementAmount: amount });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save disbursement settings');
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
      <Field label="Minimum amount (KSh)" required>
        <input
          type="number"
          min={0}
          style={inputStyle}
          value={minDisbursementAmount}
          onChange={(e) => setMinDisbursementAmount(e.target.value)}
        />
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

function CustomerInactivitySettingsForm({
  settings,
  onCancel,
  onSaved,
}: {
  settings: CustomerInactivitySettings;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const [noticeAfterDays, setNoticeAfterDays] = useState(String(settings.noticeAfterDays));
  const [resetAfterAdditionalDays, setResetAfterAdditionalDays] = useState(String(settings.resetAfterAdditionalDays));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    const notice = Number(noticeAfterDays);
    const reset = Number(resetAfterAdditionalDays);
    if (!Number.isInteger(notice) || notice < 1) {
      setError('Notice period must be a whole number of days, 1 or more.');
      return;
    }
    if (!Number.isInteger(reset) || reset < 1) {
      setError('Reset period must be a whole number of days, 1 or more.');
      return;
    }
    setBusy(true);
    try {
      await api.customerInactivitySettings.update({ noticeAfterDays: notice, resetAfterAdditionalDays: reset });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save inactivity settings');
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
      <Field label="Notice after (days inactive)" required>
        <input type="number" min={1} style={inputStyle} value={noticeAfterDays} onChange={(e) => setNoticeAfterDays(e.target.value)} />
      </Field>
      <Field label="Reset after notice (additional days)" required>
        <input
          type="number"
          min={1}
          style={inputStyle}
          value={resetAfterAdditionalDays}
          onChange={(e) => setResetAfterAdditionalDays(e.target.value)}
        />
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
