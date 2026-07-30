// services/api/src/main.ts
// The single public service: it serves the state, the SSE stream and every button
// on the page. Providers are wired by factory so that no service constructs its own
// pool — one pool per process (spec 5).
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getPool } from '@ngl/db';
import { AutoResetService } from './autoreset.service';
import { CatalogController } from './catalog.controller';
import { ChaosController } from './chaos.controller';
import { ChaosService } from './chaos.service';
import { CountersService } from './counters.service';
import { DeliveriesService } from './deliveries.service';
import { MediatorIntake } from './mediator.intake';
import { ConnectionsController } from './oauth/connections.controller';
import { HubSpotOAuthController } from './oauth/hubspot.controller';
import { oauthConfigFromEnv, tokenKeyFromEnv } from './oauth/oauth.config';
import { OAuthService } from './oauth/oauth.service';
import { SlackOAuthController } from './oauth/slack.controller';
import { TokenStore } from './oauth/token.store';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PresenceService } from './presence.service';
import { ResetController } from './reset.controller';
import { StateController } from './state.controller';
import { StreamController } from './stream.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeVerifier } from './stripe-verifier';
import { SwitchesController } from './switches.controller';
import { SwitchStore } from './switch.store';
import { EVENT_INTAKE, POOL, STRIPE_VERIFIER } from './tokens';

const PORT = 3001;
const AUTO_RESET_INTERVAL_MS = 30_000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173';

@Module({
  controllers: [
    CatalogController, ChaosController, ConnectionsController, HubSpotOAuthController,
    OrdersController, ResetController, SlackOAuthController, StateController,
    StreamController, StripeWebhookController, SwitchesController,
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
    {
      provide: ChaosService,
      useFactory: (intake: MediatorIntake) => new ChaosService(getPool(), intake),
      inject: [EVENT_INTAKE],
    },
    { provide: TokenStore, useFactory: () => new TokenStore(getPool(), tokenKeyFromEnv()) },
    {
      provide: OAuthService,
      useFactory: (tokens: TokenStore) =>
        new OAuthService(oauthConfigFromEnv(), PUBLIC_BASE_URL, tokens),
      inject: [TokenStore],
    },
  ],
})
export class ApiModule {}

async function bootstrap(): Promise<void> {
  // The raw body is kept because the Stripe signature is computed over the bytes.
  const app = await NestFactory.create(ApiModule, { rawBody: true });

  // Ten quiet minutes and the world repairs itself for the next visitor (spec 3).
  const autoReset = new AutoResetService(getPool());
  // A lapsed token is already treated as absent; this is what actually removes the
  // row, so "deleted after 24 hours" is true of the disk and not only of the answer.
  const tokens = app.get(TokenStore);
  const timer = setInterval(() => {
    void autoReset.tick(new Date());
    void tokens.purgeExpired();
  }, AUTO_RESET_INTERVAL_MS);
  app.enableShutdownHooks();
  process.on('beforeExit', () => clearInterval(timer));

  await app.listen(PORT, '0.0.0.0');
}

void bootstrap();
