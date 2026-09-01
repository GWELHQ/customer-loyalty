import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { FraudDetectionService } from './fraud-detection.service';
import { FraudFlagsController } from './fraud-flags.controller';
import { FraudFlagsService } from './fraud-flags.service';

@Module({
  imports: [CustomersModule, ShiftsModule],
  controllers: [FraudFlagsController],
  providers: [FraudFlagsService, FraudDetectionService],
  exports: [FraudFlagsService, FraudDetectionService],
})
export class FraudModule {}
