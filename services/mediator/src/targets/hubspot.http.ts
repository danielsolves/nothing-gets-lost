// services/mediator/src/targets/hubspot.http.ts
// One way in to HubSpot, shared by the contact writer and the order writer.
//
// It exists because both of them need the same three decisions made the same way:
// the bearer header, which statuses are worth retrying, and that a body which is not
// json is an empty object rather than a crash. Two copies of that would drift, and
// the half that drifted would be the half that decides whether a delivery is retried
// or parked for a human.
//
// The base url is the egress gate, never api.hubapi.com. That is what makes "cut the
// connection to HubSpot" a real cut rather than a label (spec 7).
import { CALLER_TIMEOUT_MS } from '@ngl/contracts';
import type { HubSpotCredentials } from '../credentials';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface HubSpotReply {
  status: number;
  body: unknown;
}

export class HubSpotHttp {
  constructor(
    readonly baseUrl: string,
    private readonly doFetch: Fetch = fetch,
  ) {}

  /**
   * Throws on 5xx and 429 so the queue retries them, and returns everything else for
   * the caller to read. A 400 is our fault and retrying it six times would only park
   * the same mistake more slowly.
   */
  async call(
    creds: HubSpotCredentials, path: string, init?: RequestInit,
  ): Promise<HubSpotReply> {
    const response = await this.doFetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${creds.token}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(CALLER_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status >= 500 || response.status === 429) {
      throw new Error(`HubSpot responded ${response.status}`);
    }
    return { status: response.status, body };
  }
}
