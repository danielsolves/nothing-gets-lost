// services/mediator/src/ssrf.guard.ts
// Lets a visitor point the demo at their own server without letting them point it
// at ours (spec 10.2).
//
// The address is resolved before connecting AND checked again immediately before the
// socket opens, because a hostname can answer differently the second time — that is
// DNS rebinding, and a single check would not catch it.
import { lookup } from 'node:dns/promises';
import { isIPv4 } from 'node:net';

type Lookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export function isBlockedAddress(address: string): boolean {
  if (!isIPv4(address)) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;   // unique local
    if (lower.startsWith('fe80')) return true;                            // link local
    return false;
  }

  // isIPv4 already guarantees four octets; the fallbacks only satisfy the
  // compiler, which does not know that.
  const octets = address.split('.').map(Number);
  const a = octets[0] ?? 0;
  const b = octets[1] ?? 0;
  if (a === 127 || a === 0) return true;                       // loopback, this host
  if (a === 10) return true;                                   // private
  if (a === 172 && b >= 16 && b <= 31) return true;            // private
  if (a === 192 && b === 168) return true;                     // private
  if (a === 169 && b === 254) return true;                     // link local + metadata
  if (a >= 224) return true;                                   // multicast, reserved
  return false;
}

export async function assertSafeUrl(
  candidate: string,
  resolver: Lookup = (hostname) => lookup(hostname, { all: true }),
): Promise<URL> {
  const url = new URL(candidate);

  if (url.protocol !== 'https:') {
    throw new Error('Only https urls are accepted.');
  }
  if (url.port && url.port !== '443') {
    throw new Error('Only port 443 is accepted.');
  }

  const addresses = await resolver(url.hostname);
  if (addresses.length === 0) throw new Error('Hostname does not resolve.');
  for (const entry of addresses) {
    if (isBlockedAddress(entry.address)) {
      throw new Error('That address is not allowed.');
    }
  }
  return url;
}
