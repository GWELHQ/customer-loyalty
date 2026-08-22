import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../data/client';
import { useStations } from '../../data/useStations';
import { AppShell } from '../../layout/AppShell';
import { Button, Card, Field, inputStyle } from '../../ui/primitives';

export function CustomerCreate() {
  const api = useApi();
  const navigate = useNavigate();
  const { stations } = useStations();
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [homeStationId, setHomeStationId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const customer = await api.customers.create({ fullName, phoneNumber, homeStationId: homeStationId || undefined });
      navigate(`/customers/${customer.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create customer');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Add customer" subtitle="They can earn cashback at any station once created here">
      <Card style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12 }}>
              {error}
            </div>
          )}
          <Field label="Full name" required>
            <input style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Wanjiku" />
          </Field>
          <Field label="Phone number" required>
            <input style={inputStyle} value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="0712345678" />
          </Field>
          <Field label="Home station (optional, for reporting only)">
            <select style={inputStyle} value={homeStationId} onChange={(e) => setHomeStationId(e.target.value)}>
              <option value="">No home station</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="primary" onClick={submit} disabled={busy || !fullName || !phoneNumber}>
              {busy ? 'Saving…' : 'Save customer'}
            </Button>
            <Button variant="secondary" onClick={() => navigate('/customers')}>
              Cancel
            </Button>
          </div>
        </div>
      </Card>
    </AppShell>
  );
}
