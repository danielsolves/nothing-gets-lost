// services/mediator/test/targets/index.test.ts
// What the mediator is holding when it starts. Two claims, and the second one is the
// reason this file exists: a target whose credentials are missing must still be
// built, because a mediator that refuses to start over an unset PayPal key would
// take the whole demo down for the orders that never asked for PayPal.
import { describe, it, expect } from 'vitest';
import { TARGETS } from '@ngl/contracts';
import { buildTargets } from '../../src/targets/index';
import { CredentialResolver } from '../../src/credentials';
import type { SlackSendLog } from '../../src/slack-send.log';

const credentials = new CredentialResolver({
  slackToken: '', slackChannel: '', hubspotToken: '',
});

const sendLog: SlackSendLog = {
  async begin() { return { status: 'fresh' }; },
  async complete() { /* nothing to record in this test */ },
  async abandon() { /* nothing to record in this test */ },
};

describe('buildTargets', () => {
  it('wires one target for every name the contract knows', () => {
    // A queued delivery whose target is not in this list is marked failed by the
    // worker and retries its way into the dead letter box for no reason at all.
    const built = buildTargets(credentials, sendLog, {});
    expect(built.map((target) => target.target).sort()).toEqual([...TARGETS].sort());
  });

  it('builds paypal with no credentials, and fails on the delivery instead', async () => {
    const [paypal] = buildTargets(credentials, sendLog, {})
      .filter((target) => target.target === 'paypal');
    await expect(
      paypal.deliver({ eventId: 'evt-1', idempotencyKey: 'evt-1:paypal', payload: {} }),
    ).rejects.toThrow(/PAYPAL_CLIENT_ID/);
  });
});
