// services/api/src/main.ts
// The single public service: it serves the state, the SSE stream and every button
// on the page. Providers are wired by factory so that no service constructs its own
// pool — one pool per process (spec 5).
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getPool } from '@ngl/db';
import { AutoResetService } from './autoreset.service';
import { BoardService } from './board.service';
import { CatalogController } from './catalog.controller';
import { ChaosController } from './chaos.controller';
import { ChaosService } from './chaos.service';
import { CleanupService } from './cleanup.service';
import { CountersService } from './counters.service';
import { DeliveriesService } from './deliveries.service';
import { ExtractOrderController, EXTRACT_ORDER_SERVICE } from './extract-order.controller';
import { ExtractOrderService } from './extract-order.service';
import { HttpExtractor } from './extractor.client';
import { McpProxyController, MCP_UPSTREAM } from './mcp-proxy.controller';
import { MediatorIntake } from './mediator.intake';
import { OrderViewsService } from './order-views.service';
import { DemoOrderController } from './demo-order.controller';
import { OrdersController, RATE_LIMITER } from './orders.controller';
import { trustTheProxy } from './trusted-proxy';
import { OrdersService } from './orders.service';
import { PresenceService } from './presence.service';
import { ResetController } from './reset.controller';
import { StateController } from './state.controller';
import { StreamController } from './stream.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeVerifier } from './stripe-verifier';
import { SwitchesController } from './switches.controller';
import { SwitchStore } from './switch.store';
import { WebhookTargetController, WEBHOOK_TARGET_STORE } from './webhook-target.controller';
import { WebhookTargetStore } from './webhook-target.store';
import { RateLimiter } from './rate-limit.guard';
import { DuplicatesStore } from './duplicates.store';
import { VerifyController } from './verify.controller';
import { DeliveryRecords, VerifyService } from './verify.service';
import { CredentialResolver, HubSpotClient, SlackClient } from '@ngl/mediator';
import { EVENT_INTAKE, POOL, STRIPE_VERIFIER } from './tokens';

const PORT = 3001;
const AUTO_RESET_INTERVAL_MS = 30_000;
// Hourly rather than at a fixed hour of the night: the container may be started
// at any time and may not live a whole day, and a sweep that never runs keeps
// addresses no one promised to keep (spec 14).
const CLEANUP_INTERVAL_MS = 60 * 60_000;

// The read-back goes through the egress gate like every other outbound call, so a
// cut connection fails the verification too instead of quietly bypassing it.
const EGRESS_URL = process.env.EGRESS_URL ?? 'http://egress-gate:3003';

// Where /api/mcp relays to. The service name inside the compose network, so nothing
// has to be set for a clone to work; a host running the api outside the network sets
// MCP_URL instead.
const MCP_URL = process.env.MCP_URL ?? 'http://mcp:3007/mcp';

@Module({
  controllers: [
    CatalogController, ChaosController, DemoOrderController,
    ExtractOrderController, McpProxyController, OrdersController, ResetController,
    StateController, StreamController, StripeWebhookController,
    SwitchesController, VerifyController, WebhookTargetController,
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
      useFactory: (intake: MediatorIntake) =>
        new OrdersService(getPool(), intake, new WebhookTargetStore(getPool())),
      inject: [EVENT_INTAKE],
    },
    {
      // Its own extractor client rather than the chaos service's fetch call, and no
      // intake: this provider can read a mail and cannot place an order, which is
      // what makes the confirmation step structural rather than a rule.
      provide: EXTRACT_ORDER_SERVICE,
      useFactory: () => new ExtractOrderService(getPool(), new HttpExtractor()),
    },
    { provide: CountersService, useFactory: () => new CountersService(getPool()) },
    { provide: DeliveriesService, useFactory: () => new DeliveriesService(getPool()) },
    { provide: OrderViewsService, useFactory: () => new OrderViewsService(getPool()) },
    { provide: SwitchStore, useFactory: () => new SwitchStore(getPool()) },
    {
      provide: BoardService,
      useFactory: (
        counters: CountersService, deliveries: DeliveriesService,
        orders: OrderViewsService, switches: SwitchStore,
      ) => new BoardService(counters, deliveries, orders, switches),
      inject: [CountersService, DeliveriesService, OrderViewsService, SwitchStore],
    },
    {
      provide: ChaosService,
      useFactory: (intake: MediatorIntake) => new ChaosService(getPool(), intake, new DuplicatesStore(getPool())),
      inject: [EVENT_INTAKE],
    },
    {
      // The same resolver the mediator uses, so the check button reads back from the
      // account the entry actually went to rather than from a second copy of the
      // configuration that could drift away from it.
      provide: VerifyService,
      useFactory: () => new VerifyService(
        {
          hubspot: new HubSpotClient(`${EGRESS_URL}/proxy/hubspot`),
          slack: new SlackClient(`${EGRESS_URL}/proxy/slack`),
        },
        new DeliveryRecords(getPool()),
        new CredentialResolver({
          slackToken: process.env.SLACK_BOT_TOKEN ?? '',
          slackChannel: process.env.SLACK_CHANNEL_ID ?? '',
          hubspotToken: process.env.HUBSPOT_TOKEN ?? '',
        }),
      ),
    },
    { provide: WEBHOOK_TARGET_STORE, useFactory: () => new WebhookTargetStore(getPool()) },
    { provide: RATE_LIMITER, useFactory: () => new RateLimiter(getPool()) },
    { provide: MCP_UPSTREAM, useValue: MCP_URL },
  ],
})
export class ApiModule {}

async function bootstrap(): Promise<void> {
  // The raw body is kept because the Stripe signature is computed over the bytes.
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, { rawBody: true });

  // Who the caller is, and therefore whether any cap on this service means anything.
  // The reasoning is in trusted-proxy.ts, which is a separate file because this one
  // starts a server when it is imported and the decision deserved a test.
  trustTheProxy(app);

  // Ten quiet minutes and the world repairs itself for the next visitor (spec 3).
  const autoReset = new AutoResetService(getPool());
  const timer = setInterval(() => {
    void autoReset.tick(new Date());
  }, AUTO_RESET_INTERVAL_MS);
  // The day-old addresses go. Swept once at boot so a container that is restarted
  // daily still sweeps. A failed sweep is reported and retried an hour later: it
  // must never take the public service down.
  const cleanup = new CleanupService(getPool());
  const sweep = (): void => {
    cleanup.run().catch((error: unknown) => console.error('cleanup failed', error));
  };
  sweep();
  const cleanupTimer = setInterval(sweep, CLEANUP_INTERVAL_MS);

  app.enableShutdownHooks();
  process.on('beforeExit', () => {
    clearInterval(timer);
    clearInterval(cleanupTimer);
  });

  await app.listen(PORT, '0.0.0.0');
}

void bootstrap();
