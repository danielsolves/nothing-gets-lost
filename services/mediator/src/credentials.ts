// services/mediator/src/credentials.ts
// Answers one question per delivery: whose Slack workspace, whose HubSpot portal.
//
// Read fresh every time rather than cached, for the same reason the custom webhook
// url is: connecting and disconnecting happen in the api, in another process, while
// deliveries are already queued here. A cache would mean "Disconnect" is a button
// that does nothing until someone restarts the mediator.
//
// Every failure path leads back to the house credentials. A visitor who connects
// nothing must not be able to tell this code exists, and a connection we cannot read
// is a connection we do not have — not a reason to strand the queue.
import type { TokenStore } from '@ngl/db';

export interface SlackCredentials {
  token: string;
  channel: string;
  /** True when this is the visitor's own workspace, which changes how we dedupe. */
  visitor: boolean;
}

export interface HubSpotCredentials {
  token: string;
  visitor: boolean;
}

export interface HouseCredentials {
  slackToken: string;
  slackChannel: string;
  hubspotToken: string;
}

export class CredentialResolver {
  constructor(
    private readonly house: HouseCredentials,
    private readonly tokens?: TokenStore,
  ) {}

  async slack(): Promise<SlackCredentials> {
    const held = await this.held('slack');
    // A token without a channel cannot post anywhere: it is theirs, our channel is
    // not in their workspace. Half a connection is no connection.
    if (!held?.targetRef) {
      return {
        token: this.house.slackToken, channel: this.house.slackChannel, visitor: false,
      };
    }
    return { token: held.token, channel: held.targetRef, visitor: true };
  }

  async hubspot(): Promise<HubSpotCredentials> {
    const held = await this.held('hubspot');
    if (!held) return { token: this.house.hubspotToken, visitor: false };
    return { token: held.token, visitor: true };
  }

  private async held(
    provider: 'slack' | 'hubspot',
  ): Promise<{ token: string; targetRef: string | null } | null> {
    if (!this.tokens) return null;
    try {
      return await this.tokens.load(provider);
    } catch (error) {
      // A row we cannot decrypt — most likely api and mediator holding different
      // keys because TOKEN_ENCRYPTION_KEY is unset. Say so once and carry on with
      // the house credentials; the delivery is not the place to argue about config.
      console.warn(
        `[credentials] stored ${provider} connection is unreadable, ` +
        `delivering to the house account instead: ${describe(error)}`,
      );
      return null;
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
