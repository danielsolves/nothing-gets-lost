// services/api/src/oauth/slack.controller.ts
// GET /oauth/slack/start and /callback — the visitor connects their own workspace and
// the notification appears in their Slack, on their phone (spec 10.1). Both ends are
// redirects: the person on the other side is looking at a page, not at an API.
import { Controller, Get, Inject, Query, Redirect } from '@nestjs/common';
import { OAuthService } from './oauth.service';

@Controller('oauth/slack')
export class SlackOAuthController {
  // Token spelled out: esbuild emits no decorator metadata to infer it from.
  constructor(@Inject(OAuthService) private readonly oauth: OAuthService) {}

  @Get('start')
  @Redirect()
  start(): { url: string } {
    if (!this.oauth.isConfigured('slack')) {
      return { url: this.oauth.pageUrl('slack', 'unavailable') };
    }
    return { url: this.oauth.start('slack').url };
  }

  @Get('callback')
  @Redirect()
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<{ url: string }> {
    return { url: await this.oauth.completeFromCallback('slack', code, state) };
  }
}
