import { Module } from '@nestjs/common';
import { CashbackLedgersModule } from '../cashback-ledgers/cashback-ledgers.module';
import { DisbursementBatchesController } from './disbursement-batches.controller';
import { DisbursementBatchesService } from './disbursement-batches.service';

@Module({
  imports: [CashbackLedgersModule],
  controllers: [DisbursementBatchesController],
  providers: [DisbursementBatchesService],
})
export class DisbursementBatchesModule {}
