import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { Role, UserStatus } from '@loyalty/shared';
import { AppModule } from '../src/app.module';
import { MicrosoftOidcService } from '../src/auth/microsoft-oidc.service';
import { UsersService } from '../src/users/users.service';

/**
 * Mocks only the Microsoft JWKS verification boundary (the one thing that
 * genuinely requires network access to login.microsoftonline.com) and runs
 * everything downstream — Firestore matching/provisioning, session issuance
 * for a not-yet-activated account, PermissionsGuard's status check — for
 * real against the emulator.
 */
describe('Microsoft login (e2e, mocked id_token verification)', () => {
  let app: INestApplication;
  const mockVerify = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MicrosoftOidcService)
      .useValue({ verifyIdToken: mockVerify })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues a restricted session for a first-time Microsoft sign-in whose provisioned account starts inactive', async () => {
    mockVerify.mockResolvedValueOnce({
      oid: 'ms-oid-new-user',
      email: 'new.person@greenwellsenergies.co.ke',
      name: 'New Person',
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/microsoft/callback')
      .send({ idToken: 'irrelevant-because-mocked' });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.status).toBe(UserStatus.INACTIVE);

    // The session is real but powerless: every permission-gated route is
    // rejected regardless of the account's (default) role.
    const usersRes = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(usersRes.status).toBe(403);

    // /auth/me has no permission requirement, so the pending session can
    // still use it to know who it is and render a "waiting" screen.
    const meRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.status).toBe(UserStatus.INACTIVE);
  });

  it('issues an app session once the Admin has activated the provisioned account', async () => {
    mockVerify.mockResolvedValueOnce({
      oid: 'ms-oid-active-user',
      email: 'active.person@greenwellsenergies.co.ke',
      name: 'Active Person',
    });
    // First call provisions the inactive user.
    await request(app.getHttpServer())
      .post('/api/v1/auth/microsoft/callback')
      .send({ idToken: 'irrelevant' });

    const users = app.get(UsersService);
    const provisioned = await users.findByEmail('active.person@greenwellsenergies.co.ke');
    expect(provisioned).not.toBeNull();
    await users.update(provisioned!.id, { role: Role.RTSM });
    await users.setStatus(provisioned!.id, UserStatus.ACTIVE);

    mockVerify.mockResolvedValueOnce({
      oid: 'ms-oid-active-user',
      email: 'active.person@greenwellsenergies.co.ke',
      name: 'Active Person',
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/microsoft/callback')
      .send({ idToken: 'irrelevant' });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.role).toBe(Role.RTSM);
  });
});
