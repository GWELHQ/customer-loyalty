import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { interval, map, merge, Observable } from 'rxjs';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import { ChangeEventsService } from './change-events.service';

const HEARTBEAT_MS = 20_000;

/** Staff-only (web app) live-update channel — the Android app is unaffected and keeps polling on its own schedule. */
@ApiTags('events')
@StaffOnly()
@Controller('events')
export class EventsController {
  constructor(private readonly changeEvents: ChangeEventsService) {}

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    const changes$: Observable<MessageEvent> = this.changeEvents
      .stream()
      .pipe(map((event) => ({ data: event })));
    // Keeps the connection alive through proxies/load balancers that would
    // otherwise time out an idle streaming response; the frontend ignores
    // this collection name.
    const heartbeat$: Observable<MessageEvent> = interval(HEARTBEAT_MS).pipe(
      map(() => ({ data: { collection: '__ping__' } })),
    );
    return merge(changes$, heartbeat$);
  }
}
