import http from 'node:http';
import { AddressInfo } from 'node:net';

export interface RecordedRequest {
  path: string;
  query: Record<string, string>;
}

export interface MockTricomServer {
  port: number;
  /** Every request the plugin made, in order. */
  requests: RecordedRequest[];
  /** Current output values, as the real central would report them. */
  values: Record<string, Record<string, number>>;
  /** Force the next response (status / body), bypassing normal handling. */
  failNextWith?: { status: number; body: string };
  /** Delay every response by this many ms (to exercise timeouts). */
  delayMs: number;
  close(): Promise<void>;
}

/**
 * Stands in for the "jeedom" HTTP gateway exposed by a Tricom central:
 *   GET /jeedom/allExosOutputsValues?apikey=...
 *   GET /jeedom/exoOutputValue?exo=&output=&value=&apikey=...
 */
export async function startMockTricom(
  initial: Record<string, Record<string, number>> = {},
): Promise<MockTricomServer> {
  const state: MockTricomServer = {
    port: 0,
    requests: [],
    values: JSON.parse(JSON.stringify(initial)),
    delayMs: 0,
    close: async () => {},
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      query[k] = v;
    });
    state.requests.push({ path: url.pathname, query });

    const respond = () => {
      if (state.failNextWith) {
        const { status, body } = state.failNextWith;
        state.failNextWith = undefined;
        res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end(body);
        return;
      }

      if (url.pathname === '/jeedom/allExosOutputsValues') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state.values));
        return;
      }

      if (url.pathname === '/jeedom/exoOutputValue') {
        const exo = query.exo;
        const output = query.output;
        const value = Number(query.value);
        (state.values[exo] ??= {})[output] = value;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }

      res.writeHead(404);
      res.end('not found');
    };

    if (state.delayMs > 0) {
      setTimeout(respond, state.delayMs);
    } else {
      respond();
    }
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  state.port = (server.address() as AddressInfo).port;
  state.close = () => new Promise<void>(resolve => server.close(() => resolve()));

  return state;
}
