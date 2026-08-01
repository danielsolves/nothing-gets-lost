// services/mediator/test/targets/index.test.ts
// What the mediator is holding when it starts. Two claims, and the second one is the
// reason this file exists: a target whose credentials are missing must still be
// built. This demo runs with unset keys most of the time, and a mediator that
// refused to start over one would take down every delivery that never needed it.
import { describe, it, expect } from 'vitest';
import { TARGETS } from '@ngl/contracts';
import { buildTargets } from '../../src/targets/index';
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
