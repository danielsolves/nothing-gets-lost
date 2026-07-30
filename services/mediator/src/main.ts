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
import { getPool } from '@ngl/db';
import { EnqueueController, INTAKE_SERVICE } from './enqueue.controller';
import { IntakeService } from './intake.service';
import { QueueRepository } from './queue.repository';
import { CompletionService } from './completion.service';
import { WorkerService } from './worker.service';
import type { DeliveryTarget } from './target.interface';

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
  // The delivery targets are registered here as they are built; a delivery whose
  // target is missing is rescheduled with a loud error rather than dropped.
  const targets: DeliveryTarget[] = [];
  const worker = new WorkerService(queue, targets, pool, new CompletionService(pool));

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
