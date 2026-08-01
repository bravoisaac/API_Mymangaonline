import { promises as dns } from 'node:dns';
import https from 'node:https';
import { isIP, LookupFunction } from 'node:net';

import { ValidationError } from '../utils/errors';

export type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

type OutboundUrlPolicy = {
  allowedHosts: ReadonlySet<string>;
  resolver?: HostResolver;
};

const IPV4_BLOCKS: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4]
];

const IPV6_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ['::', 96],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8]
];

export function createAllowedHostSet(baseUrl: string) {
  const parsedBaseUrl = new URL(baseUrl);

  if (parsedBaseUrl.protocol !== 'https:') {
    throw new Error('Scraper base URLs must use HTTPS');
  }

  return new Set([parsedBaseUrl.hostname.toLowerCase()]);
}

export function validateOutboundUrlSyntax(rawUrl: string, allowedHosts: ReadonlySet<string>) {
  if (rawUrl.length > 4096) {
    throw new ValidationError('Outbound URL is too long');
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new ValidationError('Invalid outbound URL');
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  if (parsedUrl.protocol !== 'https:') {
    throw new ValidationError('Only HTTPS outbound URLs are allowed');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new ValidationError('Outbound URL credentials are not allowed');
  }

  if (parsedUrl.port && parsedUrl.port !== '443') {
    throw new ValidationError('Outbound URL ports are not allowed');
  }

  if (!allowedHosts.has(hostname)) {
    throw new ValidationError('Outbound URL host is not allowed');
  }

  return parsedUrl;
}

export async function assertSafeOutboundUrl(rawUrl: string, policy: OutboundUrlPolicy) {
  const parsedUrl = validateOutboundUrlSyntax(rawUrl, policy.allowedHosts);
  const resolver = policy.resolver ?? resolveHostAddresses;
  const addresses = await resolver(parsedUrl.hostname);

  assertPublicAddresses(addresses);
  return parsedUrl;
}

export function createSafeLookup(policy: OutboundUrlPolicy): LookupFunction {
  const resolver = policy.resolver ?? resolveHostAddresses;

  return (hostname, options, callback) => {
    const normalizedHostname = hostname.toLowerCase();

    if (!policy.allowedHosts.has(normalizedHostname)) {
      callback(createLookupError('Outbound URL host is not allowed'), '', 0);
      return;
    }

    void resolver(normalizedHostname)
      .then((addresses) => {
        assertPublicAddresses(addresses);
        const requestedFamily = normalizeRequestedFamily(options.family);
        const candidates = requestedFamily
          ? addresses.filter((item) => item.family === requestedFamily)
          : addresses;

        if (candidates.length === 0) {
          throw new ValidationError('Outbound host did not resolve to the requested address family');
        }

        if (options.all) {
          callback(null, candidates);
          return;
        }

        callback(null, candidates[0].address, candidates[0].family);
      })
      .catch((error) => {
        callback(createLookupError(error instanceof Error ? error.message : 'Outbound DNS lookup failed'), '', 0);
      });
  };
}

export function createSafeHttpsAgent(policy: OutboundUrlPolicy) {
  return new https.Agent({
    keepAlive: true,
    maxSockets: 20,
    lookup: createSafeLookup(policy)
  });
}

export function isPublicIpAddress(address: string) {
  const family = isIP(address);

  if (family === 4) {
    const value = parseIpv4(address);
    return value !== undefined && !IPV4_BLOCKS.some(([base, prefix]) => isIpv4InCidr(value, base, prefix));
  }

  if (family === 6) {
    const value = parseIpv6(address);

    if (value === undefined) {
      return false;
    }

    return !IPV6_BLOCKS.some(([base, prefix]) => {
      const baseValue = parseIpv6(base);
      return baseValue !== undefined && isIpv6InCidr(value, baseValue, prefix);
    });
  }

  return false;
}

async function resolveHostAddresses(hostname: string): Promise<ResolvedAddress[]> {
  const literalFamily = isIP(hostname);

  if (literalFamily === 4 || literalFamily === 6) {
    return [{ address: hostname, family: literalFamily }];
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  return addresses.map((item): ResolvedAddress => ({
    address: item.address,
    family: item.family === 6 ? 6 : 4,
  }));
}

function assertPublicAddresses(addresses: ResolvedAddress[]) {
  if (addresses.length === 0) {
    throw new ValidationError('Outbound host did not resolve');
  }

  if (addresses.some((item) => !isPublicIpAddress(item.address))) {
    throw new ValidationError('Outbound host resolved to a blocked address');
  }
}

function normalizeRequestedFamily(family: number | string | undefined): 4 | 6 | undefined {
  if (family === 4 || family === 'IPv4') {
    return 4;
  }

  if (family === 6 || family === 'IPv6') {
    return 6;
  }

  return undefined;
}

function createLookupError(message: string) {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = 'EHOSTUNREACH';
  return error;
}

function parseIpv4(address: string) {
  const octets = address.split('.').map(Number);

  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return undefined;
  }

  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

function isIpv4InCidr(value: number, base: number, prefix: number) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) >>> 0 === (base & mask) >>> 0;
}

function parseIpv6(address: string) {
  const cleanAddress = address.split('%')[0].toLowerCase();
  const expandedAddress = expandIpv4Suffix(cleanAddress);
  const halves = expandedAddress.split('::');

  if (halves.length > 2) {
    return undefined;
  }

  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;

  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return undefined;
  }

  const groups = halves.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left;

  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return undefined;
  }

  return groups.reduce((value, group) => (value << 16n) | BigInt(Number.parseInt(group, 16)), 0n);
}

function expandIpv4Suffix(address: string) {
  const lastColon = address.lastIndexOf(':');
  const suffix = address.slice(lastColon + 1);

  if (!suffix.includes('.')) {
    return address;
  }

  const ipv4 = parseIpv4(suffix);

  if (ipv4 === undefined) {
    return address;
  }

  const high = ((ipv4 >>> 16) & 0xffff).toString(16);
  const low = (ipv4 & 0xffff).toString(16);
  return `${address.slice(0, lastColon)}:${high}:${low}`;
}

function isIpv6InCidr(value: bigint, base: bigint, prefix: number) {
  const shift = BigInt(128 - prefix);
  return value >> shift === base >> shift;
}
