// services/mediator/src/main.ts
// Boots the mediator: the enqueue endpoint plus the worker loop that drains the
// queue. Both live in one process on purpose — the queue's guarantees rest on
// the database, not on who is running, so a second copy is safe but not needed.
import 'reflect-metadata';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { getPool, TokenStore, tokenKeyFromEnv } from '@ngl/db';
import { EnqueueController, INTAKE_SERVICE } from './enqueue.controller';
import { IntakeService } from './intake.service';
import { QueueRepository } from './queue.repository';
import { CompletionService } from './completion.service';
import { WorkerService } from './worker.service';
import { buildTargets } from './targets';
import { CredentialResolver } from './credentials';
import { PgSlackSendLog } from './slack-send.log';

const PORT = 3002;

/** Exported so tests can boot the same app on an ephemeral port. */
export async function createMediatorApp(intake: IntakeService): Promise<INestApplication> {
  @Module({
    controllers: [EnqueueController],
    providers: [{ provide: INTAKE_SERVICE, useValue: intake }],
  })
  class MediatorModule {}

  return NestFactory.create(MediatorModule, { logger: false });
}

async function bootstrap(): Promise<void> {
  const pool = getPool();
  const queue = new QueueRepository(pool);
  // The visitor's url is read fresh on every delivery, so unsetting it in the
  // api takes effect on the next attempt without restarting this process.
  const webhookUrl = async (): Promise<string | null> => {
    const { rows } = await pool.query<{ url: string }>(
      'SELECT url FROM custom_webhook WHERE id',
    );
    return rows[0]?.url ?? null;
  };

  // Whose Slack and whose HubSpot an entry lands in is read from the database on
  // every delivery, so connecting or disconnecting in the api takes effect on the
  // next attempt without restarting this process.
  const credentials = new CredentialResolver(
    {
      slackToken: process.env.SLACK_BOT_TOKEN ?? '',
      slackChannel: process.env.SLACK_CHANNEL_ID ?? '',
      hubspotToken: process.env.HUBSPOT_TOKEN ?? '',
    },
    new TokenStore(pool, tokenKeyFromEnv()),
  );

  const worker = new WorkerService(
    queue,
    buildTargets(credentials, new PgSlackSendLog(pool), process.env, webhookUrl),
    pool,
    new CompletionService(pool),
  );

  const app = await createMediatorApp(new IntakeService(pool, queue));
  await app.listen(PORT, '0.0.0.0');
  worker.start();
}

// Only when run as a process. Importing this file — as the tests do, to boot the
// same app on an ephemeral port — must not start a second worker loop.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) void bootstrap();
