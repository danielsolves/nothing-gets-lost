// services/mediator/src/credentials.ts
// Answers one question per delivery: which Slack workspace, which HubSpot portal.
//
// It used to answer two, because a visitor could connect their own account and an
// entry then landed there instead. That is gone. A stranger does not hand a
// portfolio page OAuth with write access to their CRM, and asking for it cost an
// encrypted store of other people's credentials, a data protection surface and a
// branch in three places, for nobody. What carries that job now is the visitor's own
// endpoint: a url, no login, and the same deliveries arriving where they can watch
// them land.
//
// The resolver stays although it now has one source. It is the single place the
// house configuration is read, and the mediator and the check button on the api need
// the same answer; two processes each reading process.env is how they come to
// disagree about which account an entry went to.
export interface SlackCredentials {
  token: string;
  channel: string;
}

export interface HubSpotCredentials {
  token: string;
}

export interface HouseCredentials {
  slackToken: string;
  slackChannel: string;
  hubspotToken: string;
}

export class CredentialResolver {
  constructor(private readonly house: HouseCredentials) {}

  async slack(): Promise<SlackCredentials> {
    return { token: this.house.slackToken, channel: this.house.slackChannel };
  }

  async hubspot(): Promise<HubSpotCredentials> {
    return { token: this.house.hubspotToken };
  }
}
