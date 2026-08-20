import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { SpecialRateRequestsController } from './special-rate-requests.controller';
import { SpecialRateRequestsService } from './special-rate-requests.service';

@Module({
  imports: [CustomersModule, NotificationsModule, UsersModule],
  controllers: [SpecialRateRequestsController],
  providers: [SpecialRateRequestsService],
  exports: [SpecialRateRequestsService],
})
export class SpecialRateRequestsModule {}
