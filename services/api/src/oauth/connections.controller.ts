// services/api/src/oauth/connections.controller.ts
// GET /api/connections and POST /api/connections/:kind/disconnect — what the panel
// needs to say whether something is connected and to end it on the spot (spec 9.4,
// 10.1). It reports that a connection exists and when it lapses, never the token.
import { Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type { ConnectionsResponse } from '@ngl/contracts';
import type { Provider } from './oauth.service';
import { TokenStore } from '@ngl/db';

type Connection = ConnectionsResponse['slack'];

@Controller('api/connections')
export class ConnectionsController {
  // Token spelled out: esbuild emits no decorator metadata to infer it from.
  constructor(@Inject(TokenStore) private readonly tokens: TokenStore) {}

  @Get()
  async list(): Promise<ConnectionsResponse> {
    return {
      slack: await this.describe('slack'),
      hubspot: await this.describe('hubspot'),
      // The visitor's own endpoint is set through POST /api/webhook-target, which is
      // not part of the two OAuth flows; until that controller exists there is
      // nothing stored to report.
      customWebhook: { url: null },
    };
  }

  @Post(':kind/disconnect')
  async disconnect(@Param('kind') kind: string): Promise<{ ok: boolean }> {
    if (kind !== 'slack' && kind !== 'hubspot') return { ok: false };
    await this.tokens.forget(kind);
    return { ok: true };
  }

  private async describe(provider: Provider): Promise<Connection> {
    try {
      const held = await this.tokens.load(provider);
      return {
        connected: held !== null,
        expiresAt: held?.expiresAt.toISOString() ?? null,
      };
    } catch {
      // A row that no longer decrypts — the key changed under it — is a row we can
      // never use again. Dropping it is the honest answer to "are you connected?".
      await this.tokens.forget(provider);
      return { connected: false, expiresAt: null };
    }
  }
}
