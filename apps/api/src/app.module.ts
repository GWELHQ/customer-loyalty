import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AttendantsModule } from './attendants/attendants.module';
import { AuditEventsModule } from './audit-events/audit-events.module';
import { AuthModule } from './auth/auth.module';
import { CashbackLedgersModule } from './cashback-ledgers/cashback-ledgers.module';
import { AuditModule } from './common/audit/audit.module';
import { CustomerRegistrationsModule } from './customer-registrations/customer-registrations.module';
import configuration from './config/configuration';
import { EmailModule } from './common/email/email.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { FirestoreModule } from './common/firestore/firestore.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { StorageModule } from './common/storage/storage.module';
import { TokenModule } from './common/token/token.module';
import { CustomersModule } from './customers/customers.module';
import { DisbursementBatchesModule } from './disbursement-batches/disbursement-batches.module';
import { JobsModule } from './jobs/jobs.module';
import { MobileModule } from './mobile/mobile.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PricesModule } from './prices/prices.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { ReportsModule } from './reports/reports.module';
import { SalesModule } from './sales/sales.module';
import { SmsModule } from './sms/sms.module';
import { SpecialRateRequestsModule } from './special-rate-requests/special-rate-requests.module';
import { StationsModule } from './stations/stations.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 120 }] }),
    ScheduleModule.forRoot(),
    FirestoreModule,
    StorageModule,
    TokenModule,
    AuditModule,
    EmailModule,
    AuthModule,
    UsersModule,
    AttendantsModule,
    StationsModule,
    CustomersModule,
    PricesModule,
    SalesModule,
    MobileModule,
    SpecialRateRequestsModule,
    CustomerRegistrationsModule,
    ReconciliationModule,
    CashbackLedgersModule,
    DisbursementBatchesModule,
    ReportsModule,
    NotificationsModule,
    AuditEventsModule,
    SmsModule,
    JobsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
