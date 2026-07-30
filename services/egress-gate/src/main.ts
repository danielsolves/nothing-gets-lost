// services/egress-gate/src/main.ts
// Entry point of the gate: wires the database-backed switch store to the proxy and
// listens on 3003, the single door every outbound call of the demo leaves through.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { EGRESS_BASE_URLS } from '@ngl/contracts';
import { getPool } from '@ngl/db';
import { ProxyController, SWITCH_READER, BASE_URL_MAP } from './proxy.controller';
import { SwitchStore } from './switch.store';

@Module({
  controllers: [ProxyController],
  providers: [
    { provide: SWITCH_READER, useFactory: () => new SwitchStore(getPool()) },
    { provide: BASE_URL_MAP, useValue: EGRESS_BASE_URLS },
  ],
})
class EgressGateModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(EgressGateModule);
  await app.listen(3003, '0.0.0.0');
}
void bootstrap();
