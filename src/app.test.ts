import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';

let baseUrl = '';
let server: Server;

before(async () => {
  process.env.CORS_ORIGIN = 'http://localhost:8081,http://127.0.0.1:8081';
  const { app } = await import('./app');
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('health endpoint returns hardened response headers', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'http://localhost:8081' }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:8081');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('does not grant CORS to unlisted browser origins', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://untrusted.example' }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('rejects repeated scalar query values without contacting an upstream source', async () => {
  const response = await fetch(`${baseUrl}/api/manga/search/all?q=one&q=two`);
  const payload = await response.json() as { error: { message: string; stack?: string } };

  assert.equal(response.status, 400);
  assert.match(payload.error.message, /q must be a string/);
  assert.equal(payload.error.stack, undefined);
});

test('rejects unsupported language values with a 400 response', async () => {
  const response = await fetch(`${baseUrl}/api/manga/tags?lang=de`);
  const payload = await response.json() as { error: { message: string } };

  assert.equal(response.status, 400);
  assert.match(payload.error.message, /lang must be one of/);
});
