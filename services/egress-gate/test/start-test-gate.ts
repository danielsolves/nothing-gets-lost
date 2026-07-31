// services/egress-gate/test/start-test-gate.ts
// Boots the gate with an in-memory switch state and a single fake upstream, so the
// wire behaviour can be tested without a database.
import 'reflect-metadata';
import { raw } from 'express';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ProxyController, SWITCH_READER, BASE_URL_MAP } from '../src/proxy.controller';

export async function startTestGate(upstreamUrl: string) {
  let state = 'up';
  @Module({
    controllers: [ProxyController],
    providers: [
      { provide: SWITCH_READER, useValue: { get: async () => state } },
      { provide: BASE_URL_MAP, useValue: { ledger: upstreamUrl } },
    ],
  })
  class TestModule {}

  // Same wiring as production, or the tests would be exercising a different gate.
  const app = await NestFactory.create(TestModule, { logger: false, bodyParser: false });
  app.use(raw({ type: () => true, limit: '5mb' }));
  await app.listen(0);
  const url = await app.getUrl();
  return {
    url,
    setState: (next: string) => { state = next; },
    close: () => app.close(),
  };
}
