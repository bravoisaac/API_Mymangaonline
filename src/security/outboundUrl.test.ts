import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSafeOutboundUrl,
  createSafeLookup,
  isPublicIpAddress,
  ResolvedAddress,
  validateOutboundUrlSyntax
} from './outboundUrl';

const allowedHosts = new Set(['manga.example']);

test('accepts an HTTPS URL on the exact allowed host', () => {
  const url = validateOutboundUrlSyntax('https://manga.example/series/one', allowedHosts);
  assert.equal(url.hostname, 'manga.example');
});

test('rejects unsafe schemes, credentials, ports and deceptive hosts', () => {
  const invalidUrls = [
    'http://manga.example/series/one',
    'https://manga.example@evil.example/series/one',
    'https://evil.example/series/one',
    'https://manga.example.evil.example/series/one',
    'https://manga.example:444/series/one'
  ];

  invalidUrls.forEach((url) => {
    assert.throws(() => validateOutboundUrlSyntax(url, allowedHosts));
  });
});

test('classifies private and reserved IPv4 and IPv6 addresses as blocked', () => {
  const blocked = [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    'ff00::1',
    '2001:db8::1'
  ];

  blocked.forEach((address) => assert.equal(isPublicIpAddress(address), false, address));
  assert.equal(isPublicIpAddress('8.8.8.8'), true);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);
});

test('rejects a hostname when any DNS answer is private', async () => {
  const resolver = async (): Promise<ResolvedAddress[]> => [
    { address: '8.8.8.8', family: 4 },
    { address: '127.0.0.1', family: 4 }
  ];

  await assert.rejects(
    assertSafeOutboundUrl('https://manga.example/series/one', { allowedHosts, resolver }),
    /blocked address/
  );
});

test('uses a checked DNS lookup for the actual outbound connection', async () => {
  const resolver = async (): Promise<ResolvedAddress[]> => [{ address: '169.254.169.254', family: 4 }];
  const lookup = createSafeLookup({ allowedHosts, resolver });

  await new Promise<void>((resolve, reject) => {
    lookup('manga.example', { all: false }, (error) => {
      try {
        assert.ok(error);
        assert.equal(error?.code, 'EHOSTUNREACH');
        resolve();
      } catch (assertionError) {
        reject(assertionError);
      }
    });
  });
});
