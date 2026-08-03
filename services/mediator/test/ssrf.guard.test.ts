// services/mediator/test/ssrf.guard.test.ts
// Adversarial by design: every case here is an attempt to make the demo call
// something on our side of the fence. The resolver is injected so the suite never
// touches real DNS and never opens a socket.
import { describe, it, expect } from 'vitest';
import { assertSafeUrl, isBlockedAddress } from '../src/ssrf.guard';

describe('isBlockedAddress', () => {
  it('blocks loopback', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('127.5.5.5')).toBe(true);
    expect(isBlockedAddress('::1')).toBe(true);
  });

  it('blocks the private ranges', () => {
    expect(isBlockedAddress('10.0.0.1')).toBe(true);
    expect(isBlockedAddress('172.16.0.1')).toBe(true);
    expect(isBlockedAddress('172.31.255.255')).toBe(true);
    expect(isBlockedAddress('192.168.1.1')).toBe(true);
    expect(isBlockedAddress('fc00::1')).toBe(true);
  });

  it('blocks link local and the cloud metadata address', () => {
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
  });

  it('allows an ordinary public address', () => {
    expect(isBlockedAddress('93.184.216.34')).toBe(false);
    expect(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });

  it('does not mistake 172.32 for a private address', () => {
    expect(isBlockedAddress('172.32.0.1')).toBe(false);
    expect(isBlockedAddress('172.15.0.1')).toBe(false);
  });
});

describe('assertSafeUrl', () => {
  const resolves = (address: string) => async () => [{ address, family: 4 }];

  it('rejects plain http', async () => {
    await expect(assertSafeUrl('http://example.com/hook', resolves('93.184.216.34')))
      .rejects.toThrow(/https/i);
  });

  it('rejects a non standard port', async () => {
    await expect(assertSafeUrl('https://example.com:8080/hook', resolves('93.184.216.34')))
      .rejects.toThrow(/port/i);
  });

  it('rejects a hostname that resolves inward', async () => {
    // The classic bypass: a public-looking name pointing at 127.0.0.1.
    await expect(assertSafeUrl('https://evil.example.com/hook', resolves('127.0.0.1')))
      .rejects.toThrow(/not allowed/i);
  });

  it('accepts an ordinary public https url', async () => {
    const url = await assertSafeUrl('https://example.com/hook', resolves('93.184.216.34'));
    expect(url.hostname).toBe('example.com');
  });

  it('rejects a url that is not a url at all', async () => {
    await expect(assertSafeUrl('not a url', resolves('93.184.216.34')))
      .rejects.toThrow();
  });
});
