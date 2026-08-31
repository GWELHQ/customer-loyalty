import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../data/client';
import { useStations } from '../../data/useStations';
import { AppShell } from '../../layout/AppShell';
import { Button, Card, Field, inputStyle } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';

export function CustomerCreate() {
  const api = useApi();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { stations } = useStations();
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [homeStationId, setHomeStationId] = useState(user?.assignedStationId ?? '');
  const [licensePlateNumbers, setLicensePlateNumbers] = useState<string[]>([]);
  const [newPlate, setNewPlate] = useState('');
  const [nfcTagId, setNfcTagId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function addPlate() {
    const trimmed = newPlate.trim();
    if (!trimmed) return;
    setLicensePlateNumbers((prev) => [...prev, trimmed]);
    setNewPlate('');
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const customer = await api.customers.create({
        fullName,
        phoneNumber,
        homeStationId: homeStationId || undefined,
        licensePlateNumbers: licensePlateNumbers.length ? licensePlateNumbers : undefined,
        nfcTagId: nfcTagId || undefined,
      });
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
          <Field label="License plate numbers (optional)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {licensePlateNumbers.map((plate, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div style={{ ...inputStyle, flex: 1, display: 'flex', alignItems: 'center' }}>{plate}</div>
                  <button
                    type="button"
                    onClick={() => setLicensePlateNumbers((prev) => prev.filter((_, j) => j !== i))}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}
                    aria-label={`Remove ${plate}`}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  value={newPlate}
                  onChange={(e) => setNewPlate(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addPlate();
                    }
                  }}
                  placeholder="e.g. KAA 123B"
                />
                <Button variant="secondary" size="sm" onClick={addPlate} disabled={!newPlate.trim()}>
                  <Icon name="plus" size={13} />
                </Button>
              </div>
            </div>
          </Field>
          <Field label="NFC tag ID (optional)">
            <input style={inputStyle} value={nfcTagId} onChange={(e) => setNfcTagId(e.target.value)} placeholder="Scanned tag UID" />
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
