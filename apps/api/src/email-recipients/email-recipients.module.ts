import { Module } from '@nestjs/common';
import { CashbackTrendModule } from '../cashback-trend/cashback-trend.module';
import { PricesModule } from '../prices/prices.module';
import { RbacModule } from '../rbac/rbac.module';
import { StationsModule } from '../stations/stations.module';
import { UsersModule } from '../users/users.module';
import { EmailRecipientsController } from './email-recipients.controller';
import { EmailRecipientsService } from './email-recipients.service';

@Module({
  imports: [UsersModule, StationsModule, RbacModule, PricesModule, CashbackTrendModule],
  controllers: [EmailRecipientsController],
  providers: [EmailRecipientsService],
})
export class EmailRecipientsModule {}
