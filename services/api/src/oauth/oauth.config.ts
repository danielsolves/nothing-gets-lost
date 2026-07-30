// services/api/src/oauth/oauth.config.ts
// Reads the two OAuth apps and the token key out of the environment, so the service
// itself stays a pure object and main.ts stays wiring (spec 11: secrets only via env).
import { randomBytes } from 'node:crypto';
import type { Provider, ProviderConfig } from './oauth.service';

/** The scopes of spec 9.4 and 10.1, written down once and asked for nowhere else. */
export function oauthConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<Provider, ProviderConfig> {
  return {
    slack: {
      clientId: env.SLACK_CLIENT_ID ?? '',
      clientSecret: env.SLACK_CLIENT_SECRET ?? '',
      authorizeUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      scopes: ['chat:write'],
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

/**
 * Without a configured key the demo still has to start — five of the ten proofs need
 * no connection at all. It runs on a key that dies with the process instead: stored
 * connections then end at the next restart rather than after 24 hours, which is the
 * safe direction to be wrong in. Production sets the variable.
 */
export function tokenKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer {
  const configured = env.TOKEN_ENCRYPTION_KEY;
  if (!configured) {
    console.warn(
      'TOKEN_ENCRYPTION_KEY is not set — using a key that dies with this process. ' +
      'Visitor connections will not survive a restart.',
    );
    return randomBytes(32);
  }
  return Buffer.from(configured, 'base64');
}
