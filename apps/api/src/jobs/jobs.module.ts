import { Module } from '@nestjs/common';
import { PricesModule } from '../prices/prices.module';
import { JobsController } from './jobs.controller';

@Module({
  imports: [PricesModule],
  controllers: [JobsController],
})
export class JobsModule {}
