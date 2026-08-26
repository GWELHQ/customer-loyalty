import { Module } from '@nestjs/common';
import { StationsModule } from '../stations/stations.module';
import { UsersModule } from '../users/users.module';
import { SalesDelegationsController } from './sales-delegations.controller';
import { SalesDelegationsService } from './sales-delegations.service';

@Module({
  imports: [StationsModule, UsersModule],
  controllers: [SalesDelegationsController],
  providers: [SalesDelegationsService],
  exports: [SalesDelegationsService],
})
export class SalesDelegationsModule {}
