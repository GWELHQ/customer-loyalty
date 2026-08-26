import { Module } from '@nestjs/common';
import { CashbackLedgersModule } from '../cashback-ledgers/cashback-ledgers.module';
import { SettingsModule } from '../settings/settings.module';
import { DisbursementBatchesController } from './disbursement-batches.controller';
import { DisbursementBatchesService } from './disbursement-batches.service';

@Module({
  imports: [CashbackLedgersModule, SettingsModule],
  controllers: [DisbursementBatchesController],
  providers: [DisbursementBatchesService],
})
export class DisbursementBatchesModule {}
