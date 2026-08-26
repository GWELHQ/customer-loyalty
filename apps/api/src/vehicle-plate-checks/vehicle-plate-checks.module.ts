import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { VehiclePlateChecksController } from './vehicle-plate-checks.controller';
import { VehiclePlateChecksService } from './vehicle-plate-checks.service';
import { VisionOcrService } from './vision-ocr.service';

@Module({
  imports: [CustomersModule],
  controllers: [VehiclePlateChecksController],
  providers: [VehiclePlateChecksService, VisionOcrService],
  exports: [VehiclePlateChecksService],
})
export class VehiclePlateChecksModule {}
