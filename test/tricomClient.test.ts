import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from 'homebridge';

import { TricomClient } from '../src/tricomClient';
import { createMockLog } from './helpers/hapMock';
import { startMockTricom, MockTricomServer } from './helpers/tricomServer';

describe('TricomClient', () => {
  let server: MockTricomServer;
  let log: ReturnType<typeof createMockLog>;
  let client: TricomClient;

  beforeEach(async () => {
    server = await startMockTricom({ '1': { '1': 0, '2': 255 }, '2': { '1': 40 } });
    log = createMockLog();
    client = new TricomClient('127.0.0.1', server.port, 'secret-key', 2000, log as unknown as Logger);
  });

  afterEach(async () => {
    await server.close();
  });

  it('reads every output value from the central', async () => {
    const values = await client.getAllValues();
    expect(values).toEqual({ '1': { '1': 0, '2': 255 }, '2': { '1': 40 } });
  });

  it('calls the allExosOutputsValues path with the apikey', async () => {
    await client.getAllValues();
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].path).toBe('/jeedom/allExosOutputsValues');
    expect(server.requests[0].query).toEqual({ apikey: 'secret-key' });
  });

  it('appends the apikey with & when the path already has a query string', async () => {
    await client.setOutput(3, 4, 128);
    const req = server.requests[0];
    expect(req.path).toBe('/jeedom/exoOutputValue');
    expect(req.query).toEqual({ exo: '3', output: '4', value: '128', apikey: 'secret-key' });
  });

  it('url-encodes an apikey containing special characters', async () => {
    const encoded = new TricomClient(
      '127.0.0.1', server.port, 'a b&c=d', 2000, log as unknown as Logger,
    );
    await encoded.getAllValues();
    expect(server.requests[0].query.apikey).toBe('a b&c=d');
  });

  it('writes a value the central then reports back', async () => {
    await client.setOutput(1, 1, 255);
    const values = await client.getAllValues();
    expect(values['1']['1']).toBe(255);
  });

  it('throws on a non-2xx response', async () => {
    server.failNextWith = { status: 403, body: 'forbidden' };
    await expect(client.getAllValues()).rejects.toThrow(/HTTP 403/);
  });

  it('throws a readable error when the body is not JSON', async () => {
    server.failNextWith = { status: 200, body: '<html>Not authorized</html>' };
    await expect(client.getAllValues()).rejects.toThrow(/Invalid JSON from Tricom/);
  });

  it('aborts a request that exceeds the timeout', async () => {
    server.delayMs = 300;
    const impatient = new TricomClient(
      '127.0.0.1', server.port, 'secret-key', 50, log as unknown as Logger,
    );
    await expect(impatient.getAllValues()).rejects.toThrow();
  });

  it('rejects when the central is unreachable', async () => {
    await server.close();
    await expect(client.getAllValues()).rejects.toThrow();
  });

  it('logs writes at debug level', async () => {
    await client.setOutput(1, 2, 0);
    expect(log.at('debug').some(m => m.includes('exo=1') && m.includes('value=0'))).toBe(true);
  });
});
