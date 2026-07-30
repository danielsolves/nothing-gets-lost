// services/api/src/main.ts
// The single public service: it serves the state, the SSE stream and every button
// on the page. Providers are wired by factory so that no service constructs its own
// pool — one pool per process (spec 5).
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getPool } from '@ngl/db';
import { Pool } from 'pg';
import { AutoResetService } from './autoreset.service';
import { CatalogController } from './catalog.controller';
import { ChaosController } from './chaos.controller';
import { ChaosService } from './chaos.service';
import { CountersService } from './counters.service';
import { DeliveriesService } from './deliveries.service';
import { MediatorIntake } from './mediator.intake';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PresenceService } from './presence.service';
import { ResetController } from './reset.controller';
import { StateController } from './state.controller';
import { StreamController } from './stream.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeVerifier } from './stripe-verifier';
import { SqlController } from './sql.controller';
import { SqlService } from './sql.service';
import { SwitchesController } from './switches.controller';
import { SwitchStore } from './switch.store';
import { EVENT_INTAKE, POOL, READONLY_POOL, STRIPE_VERIFIER } from './tokens';

const PORT = 3001;
const AUTO_RESET_INTERVAL_MS = 30_000;
const READONLY_POOL_MAX = 4;

// The one place in this service that builds a second pool. It is deliberate: the
// console must reach Postgres as ngl_ro, never as the role the rest of the app uses.
function getReadonlyPool(): Pool {
  const connectionString = process.env.DATABASE_URL_READONLY;
  if (!connectionString) throw new Error('DATABASE_URL_READONLY is not set');
  return new Pool({ connectionString, max: READONLY_POOL_MAX });
}

@Module({
  controllers: [
    CatalogController, ChaosController, OrdersController, ResetController,
    SqlController, StateController, StreamController, StripeWebhookController,
    SwitchesController,
  ],
  providers: [
    PresenceService,
    { provide: POOL, useFactory: getPool },
    { provide: EVENT_INTAKE, useFactory: () => new MediatorIntake() },
    {
      provide: STRIPE_VERIFIER,
      useFactory: () => new StripeVerifier(process.env.STRIPE_WEBHOOK_SECRET),
    },
    {
      provide: OrdersService,
      useFactory: (intake: MediatorIntake) => new OrdersService(getPool(), intake),
      inject: [EVENT_INTAKE],
    },
    { provide: CountersService, useFactory: () => new CountersService(getPool()) },
    { provide: DeliveriesService, useFactory: () => new DeliveriesService(getPool()) },
    { provide: SwitchStore, useFactory: () => new SwitchStore(getPool()) },
    { provide: READONLY_POOL, useFactory: getReadonlyPool },
    {
      provide: SqlService,
      useFactory: (readonlyPool: Pool) => new SqlService(readonlyPool),
      inject: [READONLY_POOL],
    },
    {
      provide: ChaosService,
      useFactory: (intake: MediatorIntake) => new ChaosService(getPool(), intake),
      inject: [EVENT_INTAKE],
    },
  ],
})
export class ApiModule {}

async function bootstrap(): Promise<void> {
  // The raw body is kept because the Stripe signature is computed over the bytes.
  const app = await NestFactory.create(ApiModule, { rawBody: true });

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
