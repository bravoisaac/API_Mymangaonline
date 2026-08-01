import assert from 'node:assert/strict';
import test from 'node:test';

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

test('rejects arbitrary Comick-like subdomains', () => {
  assert.throws(
    () => getImageUrl('https://attacker.comicknew.pictures/example.webp'),
    /host is not allowed/
  );
});
