// services/api/src/main.ts
// The single public service: it serves the state, the SSE stream and every button
// on the page. Providers are wired by factory so that no service constructs its own
// pool — one pool per process (spec 5).
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getPool } from '@ngl/db';
import { CountersService } from './counters.service';
import { DeliveriesService } from './deliveries.service';
import { PresenceService } from './presence.service';
import { StateController } from './state.controller';
import { StreamController } from './stream.controller';
import { SwitchStore } from './switch.store';

const PORT = 3001;

@Module({
  controllers: [StateController, StreamController],
  providers: [
    PresenceService,
    { provide: CountersService, useFactory: () => new CountersService(getPool()) },
    { provide: DeliveriesService, useFactory: () => new DeliveriesService(getPool()) },
    { provide: SwitchStore, useFactory: () => new SwitchStore(getPool()) },
  ],
})
export class ApiModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ApiModule);
  await app.listen(PORT, '0.0.0.0');
}

void bootstrap();
