import { Observable } from 'rxjs';

import { Controller, Header, type MessageEvent, Req, Sse } from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/auth.controller.js';
import { StreamService } from './stream.service.js';

@Controller('stream')
export class StreamController {
  constructor(private readonly events: StreamService) {}

  @Sse()
  @Header('Cache-Control', 'no-store, no-transform')
  stream(@Req() request: AuthenticatedRequest) {
    return new Observable<MessageEvent>((subscriber) => {
      const { ready, unsubscribe } = this.events.subscribe(request.user, (type) =>
        subscriber.next({ type, data: {} }),
      );
      subscriber.next({ type: 'ping', data: {}, retry: 3000 });
      void ready.then(
        () => subscriber.next({ type: 'ready', data: {} }),
        () => subscriber.complete(),
      );
      const heartbeat = setInterval(() => subscriber.next({ type: 'ping', data: {} }), 15_000);
      // Bound connection lifetime so reconnects pass through session verification again.
      const expires = setTimeout(() => subscriber.complete(), 60_000);
      return () => {
        clearInterval(heartbeat);
        clearTimeout(expires);
        unsubscribe();
      };
    });
  }
}
