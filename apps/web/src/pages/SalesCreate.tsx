import { Product } from '@loyalty/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useStations } from '../data/useStations';
import { AppShell } from '../layout/AppShell';
import { Button, Card, Field, inputStyle } from '../ui/primitives';

export function SalesCreate() {
  const api = useApi();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { stations } = useStations();
  const [customerPhone, setCustomerPhone] = useState('');
  const [product, setProduct] = useState<Product>(Product.PMS);
  const [amountPaid, setAmountPaid] = useState('');
  const [stationId, setStationId] = useState(user?.assignedStationId ?? '');
  const [saleDate, setSaleDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await api.sales.create({
        customerPhone,
        product,
        amountPaid: Number(amountPaid),
        stationId,
        saleDate: saleDate ? new Date(saleDate).toISOString() : undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      navigate('/sales');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record sale');
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !busy && !!customerPhone && !!stationId && Number(amountPaid) > 0;

  return (
    <AppShell title="Record sale" subtitle="Manually back-fill or correct a sale — the same cashback rules apply as the Android app">
      <Card style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12 }}>
              {error}
            </div>
          )}
          <Field label="Customer phone number" required>
            <input
              style={inputStyle}
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="0712345678"
            />
          </Field>
          <Field label="Station" required>
            <select style={inputStyle} value={stationId} onChange={(e) => setStationId(e.target.value)}>
              <option value="">Select a station</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Product" required>
            <select style={inputStyle} value={product} onChange={(e) => setProduct(e.target.value as Product)}>
              {Object.values(Product).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount paid (KSh)" required>
            <input
              type="number"
              min="0"
              step="0.01"
              style={inputStyle}
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              placeholder="2068"
            />
          </Field>
          <Field label="Sale date/time (optional — defaults to now)">
            <input type="datetime-local" style={inputStyle} value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="primary" onClick={submit} disabled={!canSubmit}>
              {busy ? 'Recording…' : 'Record sale'}
            </Button>
            <Button variant="secondary" onClick={() => navigate('/sales')}>
              Cancel
            </Button>
          </div>
        </div>
      </Card>
    </AppShell>
  );
}
