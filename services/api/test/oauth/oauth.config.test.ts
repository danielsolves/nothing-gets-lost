// services/api/test/oauth/oauth.config.test.ts
// The scope list is the whole consent conversation with a stranger, so it gets a test
// rather than a comment. Two rules pull against each other here and both are pinned:
//
//   ask for enough    without incoming-webhook, oauth.v2.access returns no channel id,
//                     target_ref stays null and the delivery has nowhere to go
//   ask for no more   channels:history would let this demo read a stranger's Slack
//                     messages. We decided the bookkeeping is cheaper than the ask,
//                     so the visitor path never requests it (see slack-send.log.ts)
import { describe, it, expect } from 'vitest';
import { oauthConfigFromEnv } from '../../src/oauth/oauth.config';

const config = oauthConfigFromEnv({} as NodeJS.ProcessEnv);

describe('oauth scopes', () => {
  it('asks slack for permission to post', () => {
    expect(config.slack.scopes).toContain('chat:write');
  });

  it('asks slack for a channel picker, or the delivery has no channel', () => {
    expect(config.slack.scopes).toContain('incoming-webhook');
  });

  it('never asks a visitor to let us read their slack messages', () => {
    expect(config.slack.scopes.some((s) => s.endsWith(':history'))).toBe(false);
    expect(config.slack.scopes.some((s) => s.includes('read'))).toBe(false);
  });

  it('asks slack for nothing beyond those two', () => {
    expect([...config.slack.scopes].sort()).toEqual(['chat:write', 'incoming-webhook']);
  });

  it('asks hubspot for contacts and nothing else', () => {
    expect([...config.hubspot.scopes].sort()).toEqual([
      'crm.objects.contacts.read', 'crm.objects.contacts.write',
    ]);
  });
});
