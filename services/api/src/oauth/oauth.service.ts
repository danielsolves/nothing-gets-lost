// services/api/src/oauth/oauth.service.ts
// Lets a visitor connect their own Slack workspace or HubSpot portal — the only
// proofs where the target system belongs to them (spec 9.4, 10.1).
//
// Scopes are the narrowest that do the job: writing a message, and reading/writing
// contacts. Asking for more would be the fastest way to lose the trust this whole
// project is built to earn.
import { randomBytes } from 'node:crypto';
import type { TokenStore } from './token.store';

export type Provider = 'slack' | 'hubspot';

export interface ProviderConfig {
  clientId: string; clientSecret: string;
  authorizeUrl: string; tokenUrl: string; scopes: string[];
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** What the page is told after a callback. Never a token, never a code. */
export type CallbackOutcome = 'connected' | 'failed' | 'unavailable';

const STATE_TTL_MS = 10 * 60_000;

export class OAuthService {
  private readonly pendingStates = new Map<string, number>();

  constructor(
    private readonly config: Record<Provider, ProviderConfig>,
    private readonly publicBaseUrl: string,
    private readonly tokens: TokenStore,
    private readonly doFetch: Fetch = fetch,
  ) {}

  start(provider: Provider): { url: string; state: string } {
    this.forgetStaleStates();
    const settings = this.config[provider];
    const state = randomBytes(16).toString('hex');
    this.pendingStates.set(state, Date.now());

    const url = new URL(settings.authorizeUrl);
    url.searchParams.set('client_id', settings.clientId);
    url.searchParams.set('scope', settings.scopes.join(' '));
    url.searchParams.set('redirect_uri', this.redirectUri(provider));
    url.searchParams.set('state', state);
    if (provider === 'hubspot') url.searchParams.set('response_type', 'code');

    return { url: url.toString(), state };
  }

  async complete(provider: Provider, code: string, state: string): Promise<void> {
    if (!this.pendingStates.delete(state)) {
      throw new Error('Unknown or already used state parameter.');
    }
    const settings = this.config[provider];

    const response = await this.doFetch(settings.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        redirect_uri: this.redirectUri(provider),
      }).toString(),
    });

    const body = (await response.json()) as {
      access_token?: string;
      incoming_webhook?: { channel_id?: string };
      hub_id?: number;
    };
    if (!body.access_token) throw new Error(`${provider} did not return an access token`);

    const targetRef = provider === 'slack'
      ? body.incoming_webhook?.channel_id ?? null
      : body.hub_id?.toString() ?? null;

    await this.tokens.save(provider, body.access_token, targetRef);
  }

  /** False when the operator has not filled in the app credentials for a provider. */
  isConfigured(provider: Provider): boolean {
    const settings = this.config[provider];
    return settings.clientId !== '' && settings.clientSecret !== '';
  }

  /**
   * The browser half of `complete`: a visitor who lands here is a person looking at a
   * page, so every outcome ends as a redirect back to it rather than as a stack trace.
   */
  async completeFromCallback(
    provider: Provider, code: string | undefined, state: string | undefined,
  ): Promise<string> {
    if (!this.isConfigured(provider)) return this.pageUrl(provider, 'unavailable');
    if (!code || !state) return this.pageUrl(provider, 'failed');
    try {
      await this.complete(provider, code, state);
    } catch (error) {
      // Our own messages only — a rejected state, or a provider that sent no token.
      // The code and the token itself are never part of them and never logged.
      console.warn(`${provider} oauth callback rejected: ${describe(error)}`);
      return this.pageUrl(provider, 'failed');
    }
    return this.pageUrl(provider, 'connected');
  }

  /** Where the visitor is sent back to, with a flag the page can turn into a sentence. */
  pageUrl(provider: Provider, outcome: CallbackOutcome): string {
    const url = new URL(this.publicBaseUrl);
    url.searchParams.set('connection', provider);
    url.searchParams.set('outcome', outcome);
    return url.toString();
  }

  private redirectUri(provider: Provider): string {
    return `${this.publicBaseUrl}/oauth/${provider}/callback`;
  }

  private forgetStaleStates(): void {
    const cutoff = Date.now() - STATE_TTL_MS;
    for (const [state, issuedAt] of this.pendingStates) {
      if (issuedAt < cutoff) this.pendingStates.delete(state);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
