import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export interface ChangeEvent {
  /** Firestore collection name that changed, e.g. 'sales', 'stations'. */
  collection: string;
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

  emit(collection: string): void {
    this.subject.next({ collection });
  }

  stream(): Observable<ChangeEvent> {
    return this.subject.asObservable();
  }
}
