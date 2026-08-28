import { Module } from '@nestjs/common';
import { FraudModule } from '../fraud/fraud.module';
import { AuditEventsController } from './audit-events.controller';

@Module({
  imports: [FraudModule],
  controllers: [AuditEventsController],
})
export class AuditEventsModule {}
