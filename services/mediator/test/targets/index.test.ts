// services/mediator/test/targets/index.test.ts
// What the mediator is holding when it starts. Two claims, and the second one is the
// reason this file exists: a target whose credentials are missing must still be
// built. This demo runs with unset keys most of the time, and a mediator that
// refused to start over one would take down every delivery that never needed it.
import { describe, it, expect } from 'vitest';
import { TARGETS } from '@ngl/contracts';
import { buildTargets, webhookSigningSecret } from '../../src/targets/index';
import { CredentialResolver } from '../../src/credentials';
import type { CatalogueLog } from '../../src/hubspot-catalogue.log';

const credentials = new CredentialResolver({
  slackToken: '', slackChannel: '', hubspotToken: '',
});

const catalogueLog: CatalogueLog = {
  async claim() { return { status: 'fresh' }; },
  async record() { /* nothing to record in this test */ },
  async release() { /* nothing to record in this test */ },
};

describe('buildTargets', () => {
  it('wires one target for every name the contract knows', () => {
    // A queued delivery whose target is not in this list is marked failed by the
    // worker and retries its way into the dead letter box for no reason at all.
    const built = buildTargets(credentials, catalogueLog, {});
    expect(built.map((target) => target.target).sort()).toEqual([...TARGETS].sort());
  });

  it('builds them all from an empty environment, rather than refusing to start', () => {
    // Not the same claim as the one above, which counts names. This one is about
    // credentials: an unset key has to fail the delivery that needs it, where a
    // visitor can read the reason, and not the process that carries the other five.
    expect(() => buildTargets(credentials, catalogueLog, {})).not.toThrow();
  });
});

// `x-demo-signature` has one job: to let a visitor tell our deliveries from anybody
// else's calls to the same url. That job survives exactly as long as the key does.
describe('the webhook signing secret', () => {
  it('takes the configured secret when there is one', () => {
    expect(webhookSigningSecret({ WEBHOOK_SIGNING_SECRET: 'from-the-host' }))
      .toBe('from-the-host');
  });

  it('does not fall back to a value that can be read out of this repository', () => {
    // It used to fall back to the literal 'demo-signing-secret'. In a public
    // repository that is not a key, it is a recipe: forging the header a visitor
    // is asked to trust becomes copy and paste.
    expect(webhookSigningSecret({})).not.toBe('demo-signing-secret');
    expect(webhookSigningSecret({}).length).toBeGreaterThanOrEqual(32);
  });

  it('treats an empty variable as no variable', () => {
    // .env.example ships this line empty and `env_file` turns an empty line into an
    // empty string rather than into nothing at all, so the case a stranger actually
    // lands in is this one and not the unset one. HMAC with the empty key is every
    // bit as public as HMAC with a published one.
    expect(webhookSigningSecret({ WEBHOOK_SIGNING_SECRET: '' }))
      .toBe(webhookSigningSecret({}));
  });

  it('is one value for the whole process, so a retry signs the way the first attempt did', () => {
    // Six attempts reach the same endpoint over ten minutes. A key that changed
    // between them would show a receiver two senders where there is one.
    expect(webhookSigningSecret({})).toBe(webhookSigningSecret({}));
  });
});
