// services/api/src/oauth/hubspot.controller.ts
// GET /oauth/hubspot/start and /callback — the visitor connects their own portal and
// checks the contact in their own CRM, with their own login (spec 9.4). Same shape as
// the Slack pair; only the provider name differs.
import { Controller, Get, Inject, Query, Redirect } from '@nestjs/common';
import { OAuthService } from './oauth.service';

@Controller('oauth/hubspot')
export class HubSpotOAuthController {
  // Token spelled out: esbuild emits no decorator metadata to infer it from.
  constructor(@Inject(OAuthService) private readonly oauth: OAuthService) {}

  @Get('start')
  @Redirect()
  start(): { url: string } {
    if (!this.oauth.isConfigured('hubspot')) {
      return { url: this.oauth.pageUrl('hubspot', 'unavailable') };
    }
    return { url: this.oauth.start('hubspot').url };
  }

  @Get('callback')
  @Redirect()
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<{ url: string }> {
    return { url: await this.oauth.completeFromCallback('hubspot', code, state) };
  }
}
