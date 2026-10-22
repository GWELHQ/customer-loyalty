import { Module } from '@nestjs/common';
import { CashbackTrendModule } from '../cashback-trend/cashback-trend.module';
import { CashbackLedgersModule } from '../cashback-ledgers/cashback-ledgers.module';
import { SettingsModule } from '../settings/settings.module';
import { DisbursementBatchesController } from './disbursement-batches.controller';
import { DisbursementBatchesService } from './disbursement-batches.service';

@Module({
  imports: [CashbackLedgersModule, CashbackTrendModule, SettingsModule],
  controllers: [DisbursementBatchesController],
  providers: [DisbursementBatchesService],
})
export class DisbursementBatchesModule {}
