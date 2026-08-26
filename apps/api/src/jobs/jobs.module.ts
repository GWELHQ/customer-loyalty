import { Module } from '@nestjs/common';
import { FraudModule } from '../fraud/fraud.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PricesModule } from '../prices/prices.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { StationsModule } from '../stations/stations.module';
import { UsersModule } from '../users/users.module';
import { JobsController } from './jobs.controller';

@Module({
  imports: [PricesModule, ReconciliationModule, StationsModule, UsersModule, NotificationsModule, FraudModule],
  controllers: [JobsController],
})
export class JobsModule {}
