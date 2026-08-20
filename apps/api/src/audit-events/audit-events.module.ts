import { Module } from '@nestjs/common';
import { AuditEventsController } from './audit-events.controller';

@Module({
  controllers: [AuditEventsController],
})
export class AuditEventsModule {}
