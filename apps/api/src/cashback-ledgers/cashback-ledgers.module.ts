import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { CashbackLedgersController } from './cashback-ledgers.controller';
import { CashbackLedgersService } from './cashback-ledgers.service';

@Module({
  imports: [NotificationsModule, UsersModule],
  controllers: [CashbackLedgersController],
  providers: [CashbackLedgersService],
  exports: [CashbackLedgersService],
})
export class CashbackLedgersModule {}
