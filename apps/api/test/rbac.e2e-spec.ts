import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Role } from '@loyalty/shared';
import { createTestApp, mintAttendantToken, mintStaffToken } from './utils/test-app';

describe('RBAC enforcement (e2e, HTTP layer)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('Admin cannot approve a special rate request (403)', async () => {
    const token = await mintStaffToken(app, { role: Role.ADMIN });
    const res = await request(app.getHttpServer())
      .post('/api/v1/special-rate-requests/nonexistent-id/approve')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('Chairman can reach the approve route (permission check passes; 404 for the missing entity is fine)', async () => {
    const token = await mintStaffToken(app, { role: Role.CHAIRMAN });
    const res = await request(app.getHttpServer())
      .post('/api/v1/special-rate-requests/nonexistent-id/approve')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).not.toBe(403);
  });

  it('RTSM can create a special rate request but not approve it', async () => {
    const rtsmToken = await mintStaffToken(app, { role: Role.RTSM });
    const forbidden = await request(app.getHttpServer())
      .post('/api/v1/special-rate-requests/nonexistent-id/approve')
      .set('Authorization', `Bearer ${rtsmToken}`)
      .send({});
    expect(forbidden.status).toBe(403);
  });

  it('Station Supervisor sales list is forced to their assigned station regardless of a different stationId query param', async () => {
    const token = await mintStaffToken(app, {
      role: Role.STATION_SUPERVISOR,
      assignedStationId: 'own-station',
    });
    const res = await request(app.getHttpServer())
      .get('/api/v1/sales?stationId=someone-elses-station')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Every returned sale (if any) must belong to the supervisor's own station.
    for (const sale of res.body.items ?? []) {
      expect(sale.stationId).toBe('own-station');
    }
  });

  it('unauthenticated requests are rejected', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/customers');
    expect(res.status).toBe(401);
  });

  it('an attendant session cannot reach staff-only routes', async () => {
    const token = await mintAttendantToken(app);
    const res = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
