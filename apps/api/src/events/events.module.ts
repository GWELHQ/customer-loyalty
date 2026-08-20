import { Global, Module } from '@nestjs/common';
import { ChangeEventsService } from './change-events.service';
import { EventsController } from './events.controller';

/**
 * @Global so ChangeEventsService can be injected into any feature service
 * without that module needing to import EventsModule itself — keeps every
 * mutating service's wiring down to a constructor param and an emit() call.
 */
@Global()
@Module({
  controllers: [EventsController],
  providers: [ChangeEventsService],
  exports: [ChangeEventsService],
})
export class EventsModule {}
