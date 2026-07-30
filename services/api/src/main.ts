// services/api/src/main.ts
// The single public service: it serves the state, the SSE stream and every button
// on the page. Providers are wired by factory so that no service constructs its own
// pool — one pool per process (spec 5).
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getPool } from '@ngl/db';
import { AutoResetService } from './autoreset.service';
import { ChaosController } from './chaos.controller';
import { ChaosService } from './chaos.service';
import { CountersService } from './counters.service';
import { DeliveriesService } from './deliveries.service';
import { MediatorIntake } from './mediator.intake';
import { PresenceService } from './presence.service';
import { ResetController } from './reset.controller';
import { StateController } from './state.controller';
import { StreamController } from './stream.controller';
import { SwitchesController } from './switches.controller';
import { SwitchStore } from './switch.store';
import { EVENT_INTAKE, POOL } from './tokens';

const PORT = 3001;
const AUTO_RESET_INTERVAL_MS = 30_000;

@Module({
  controllers: [
    ChaosController, ResetController, StateController, StreamController, SwitchesController,
  ],
  providers: [
    PresenceService,
    { provide: POOL, useFactory: getPool },
    { provide: EVENT_INTAKE, useFactory: () => new MediatorIntake() },
    { provide: CountersService, useFactory: () => new CountersService(getPool()) },
    { provide: DeliveriesService, useFactory: () => new DeliveriesService(getPool()) },
    { provide: SwitchStore, useFactory: () => new SwitchStore(getPool()) },
    {
      provide: ChaosService,
      useFactory: (intake: MediatorIntake) => new ChaosService(getPool(), intake),
      inject: [EVENT_INTAKE],
    },
  ],
})
export class ApiModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ApiModule);

  // Ten quiet minutes and the world repairs itself for the next visitor (spec 3).
  const autoReset = new AutoResetService(getPool());
  const timer = setInterval(() => {
    void autoReset.tick(new Date());
  }, AUTO_RESET_INTERVAL_MS);
  app.enableShutdownHooks();
  process.on('beforeExit', () => clearInterval(timer));

  await app.listen(PORT, '0.0.0.0');
}

void bootstrap();
