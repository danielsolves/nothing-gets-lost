// services/api/src/oauth/oauth.config.ts
// Reads the two OAuth apps out of the environment, so the service itself stays a pure
// object and main.ts stays wiring (spec 11: secrets only via env).
import type { Provider, ProviderConfig } from './oauth.service';

/**
 * The scopes of spec 9.4 and 10.1, written down once and asked for nowhere else.
 *
 * Slack gets two, and the second one is a decision rather than a detail. With
 * chat:write alone, oauth.v2.access returns no channel: target_ref stays null, the
 * delivery has nowhere to post, and the visitor would have to type a channel id and
 * then invite the app into it by hand. incoming-webhook makes Slack show a channel
 * picker during install and puts the app in the channel they choose.
 *
 * What is deliberately absent is channels:history. The house workspace has it, so a
 * delivery there can read the channel back and recognise its own marker (spec 6.5).
 * Asking a visitor for it would mean this demo could read their Slack messages, to
 * save itself one database row. That is a bad trade for a project about being
 * trustworthy, so the visitor path keeps its own send log instead.
 */
export function oauthConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<Provider, ProviderConfig> {
  return {
    slack: {
      clientId: env.SLACK_CLIENT_ID ?? '',
      clientSecret: env.SLACK_CLIENT_SECRET ?? '',
      authorizeUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      scopes: ['chat:write', 'incoming-webhook'],
    },
    hubspot: {
      clientId: env.HUBSPOT_CLIENT_ID ?? '',
      clientSecret: env.HUBSPOT_CLIENT_SECRET ?? '',
      authorizeUrl: 'https://app.hubspot.com/oauth/authorize',
      tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
      scopes: ['crm.objects.contacts.write', 'crm.objects.contacts.read'],
    },
  };
}
