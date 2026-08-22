import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@loyalty/shared';
import { AppModule } from '../../src/app.module';
import { TokenService } from '../../src/common/token/token.service';
import type { AttendantPrincipal, StaffPrincipal } from '../../src/common/types/principal';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

export async function mintStaffToken(
  app: INestApplication,
  overrides: Partial<StaffPrincipal> = {},
): Promise<string> {
  const tokens = app.get(TokenService);
  const principal: StaffPrincipal = {
    kind: 'staff',
    userId: overrides.userId ?? 'test-user-1',
    email: overrides.email ?? 'test@greenwellsenergies.co.ke',
    fullName: overrides.fullName ?? 'Test User',
    role: overrides.role ?? Role.ADMIN,
    assignedStationId: overrides.assignedStationId,
    status: overrides.status ?? UserStatus.ACTIVE,
  };
  return tokens.signStaffAccessToken(principal);
}

export async function mintAttendantToken(
  app: INestApplication,
  overrides: Partial<AttendantPrincipal> = {},
): Promise<string> {
  const tokens = app.get(TokenService);
  const principal: AttendantPrincipal = {
    kind: 'attendant',
    attendantId: overrides.attendantId ?? 'test-attendant-1',
    employeeId: overrides.employeeId ?? 'KIS1-001',
    fullName: overrides.fullName ?? 'Test Attendant',
    role: Role.ATTENDANT,
    assignedStationId: overrides.assignedStationId ?? 'test-station-1',
  };
  return tokens.signAttendantAccessToken(principal);
}
