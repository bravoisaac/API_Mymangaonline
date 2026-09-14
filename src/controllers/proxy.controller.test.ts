import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import test from 'node:test';

import { app } from '../app';
import { httpClient } from '../utils/httpClient';
import { getImageUrl } from './proxy.controller';

test('accepts current Comick cover CDN hosts', () => {
  const coverPaths = [
    'https://cdn1.comicknew.pictures/example/covers/cover.webp',
    'https://cdn2.comicknew.pictures/example/covers/cover.webp'
  ];

  coverPaths.forEach((coverUrl) => {
    assert.equal(getImageUrl(coverUrl), coverUrl);
  });
});

test('accepts the exact MangaDex uploads host used by covers', () => {
  const coverUrl = 'https://uploads.mangadex.org/covers/manga-id/cover.jpg.512.jpg';

  assert.equal(getImageUrl(coverUrl), coverUrl);
});

test('rejects arbitrary Comick-like subdomains', () => {
  assert.throws(
    () => getImageUrl('https://attacker.comicknew.pictures/example.webp'),
    /host is not allowed/
  );
});

test('streams the first image bytes before the upstream download completes', async () => {
  const originalGet = httpClient.get;
  let releaseTail!: () => void;
  const waitForTail = new Promise<void>((resolve) => {
    releaseTail = resolve;
  });
  const upstreamStream = Readable.from((async function* () {
    yield Buffer.from('head');
    await waitForTail;
    yield Buffer.from('tail');
  })());

  httpClient.get = (async () => ({
    data: upstreamStream,
    headers: {
      'content-type': 'image/png'
    }
  })) as typeof httpClient.get;

  const server: Server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address() as AddressInfo;
    const url = new URL(`http://127.0.0.1:${address.port}/api/proxy/image`);
    url.searchParams.set('url', 'https://cdn1.comicknew.pictures/example/stream-test.png');

    let timeout: NodeJS.Timeout | undefined;
    const response = await Promise.race([
      fetch(url),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Proxy buffered the complete upstream image')), 1000);
      })
    ]).finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /stale-while-revalidate/);
    releaseTail();
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'headtail');
  } finally {
    releaseTail();
    httpClient.get = originalGet;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
