import {channel} from 'node:diagnostics_channel';
import type {ServerResponse} from 'node:http';

/** The HTTP server owns response completion; a returned Response is still in flight. */
class HttpRequests {
  private responses = new Set<ServerResponse>();
  get pending() { return this.responses.size; }
  constructor() {
    channel('http.server.request.start').subscribe(message => {
      const {response} = message as {response: ServerResponse};
      if (this.responses.has(response)) return;
      this.responses.add(response);
      const completed = () => {
        this.responses.delete(response);
        response.off('finish', completed);
        response.off('close', completed);
      };
      response.once('finish', completed);
      response.once('close', completed);
    });
  }
}

// The server entry, development config and SSR bundle can load separate module
// instances. One process owns exactly one subscription and one response set.
const key = Symbol.for('weava.http.requests');
const globals = globalThis as typeof globalThis & {[key: symbol]: HttpRequests};
export const httpRequests: HttpRequests = globals[key] ??= new HttpRequests();
