import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export interface ChangeEvent {
  /** Firestore collection name that changed, e.g. 'sales', 'stations'. */
  collection: string;
  /** Id of the specific document that changed, when the caller knows it — lets a client filter for "my own record changed" instead of treating every event as "refetch the whole list". */
  entityId?: string;
}

/**
 * Process-wide bus that every mutating service publishes to after a
 * successful write. EventsController fans this out to connected browser
 * tabs over SSE so list pages can refetch instantly instead of waiting for
 * a manual reload. Global (see EventsModule) so any service can inject it
 * without adding EventsModule to its own imports.
 */
@Injectable()
export class ChangeEventsService {
  private readonly subject = new Subject<ChangeEvent>();

  emit(collection: string, entityId?: string): void {
    this.subject.next({ collection, entityId });
  }

  stream(): Observable<ChangeEvent> {
    return this.subject.asObservable();
  }
}
