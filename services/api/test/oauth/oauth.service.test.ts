// services/api/test/oauth/oauth.service.test.ts
// Pins the two visitor OAuth flows without touching Slack or HubSpot: the scopes stay
// the narrow ones the spec allows, and a state parameter works once and never again.
import { describe, it, expect, beforeEach } from 'vitest';
import { OAuthService, type Provider } from '../../src/oauth/oauth.service';

const config = {
  slack: {
    clientId: 'cid', clientSecret: 'secret',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write'],
  },
  hubspot: {
    clientId: 'hid', clientSecret: 'hsecret',
    authorizeUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    scopes: ['crm.objects.contacts.write', 'crm.objects.contacts.read'],
  },
};

let saved: Array<{ provider: string; token: string; ref: string | null }>;
let service: OAuthService;

beforeEach(() => {
  saved = [];
  service = new OAuthService(
    config,
    'https://demo.example.com',
    // The store is stubbed out entirely: this test is about the flow, and no test in
    // this repo ever puts a real token anywhere. Parameters are annotated because the
    // literal is cast, so it gets no contextual type to infer them from.
    { async save(provider: Provider, token: string, ref: string | null) {
        saved.push({ provider, token, ref });
      },
      async forget() {}, async load() { return null; } } as never,
    async () => new Response(JSON.stringify({
      access_token: 'xoxb-new', incoming_webhook: { channel_id: 'C999' },
    }), { headers: { 'content-type': 'application/json' } }),
  );
});

describe('OAuthService', () => {
  it('builds an authorize url with the exact scopes the spec allows', () => {
    const { url } = service.start('slack');
    expect(url).toContain('client_id=cid');
    expect(url).toContain('scope=chat%3Awrite');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fdemo.example.com%2Foauth%2Fslack%2Fcallback');
  });

  it('asks hubspot for contact scopes only', () => {
    const { url } = service.start('hubspot');
    expect(url).toContain('crm.objects.contacts.write');
    expect(url).not.toContain('crm.objects.deals');
  });

  it('issues a state parameter and remembers it', () => {
    const { url, state } = service.start('slack');
    expect(state).toHaveLength(32);
    expect(url).toContain(`state=${state}`);
  });

  it('rejects a callback whose state was never issued', async () => {
    await expect(service.complete('slack', 'code', 'forged-state'))
      .rejects.toThrow(/state/i);
  });

  it('rejects a state a second time, so it cannot be replayed', async () => {
    const { state } = service.start('slack');
    await service.complete('slack', 'code', state);
    await expect(service.complete('slack', 'code', state)).rejects.toThrow(/state/i);
  });

  it('stores the token it received', async () => {
    const { state } = service.start('slack');
    await service.complete('slack', 'code', state);
    expect(saved).toEqual([{ provider: 'slack', token: 'xoxb-new', ref: 'C999' }]);
  });
});
