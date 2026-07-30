// services/mediator/src/enqueue.controller.ts
// The mediator's only inbound door (spec 16.2). Everything that wants an event
// queued goes through here, so the exactly-once rules live in one process and
// no caller writes the deliveries table behind the queue's back.
import { BadRequestException, Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { EVENT_KINDS, TARGETS, type EventKind, type Target } from '@ngl/contracts';
import type { IntakeInput, IntakeResult, IntakeService } from './intake.service';

export const INTAKE_SERVICE = Symbol('INTAKE_SERVICE');

function isIntakeInput(value: unknown): value is IntakeInput {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.externalId !== 'string' || candidate.externalId === '') return false;
  if (!(EVENT_KINDS as readonly string[]).includes(candidate.kind as EventKind)) return false;
  if (!Array.isArray(candidate.targets) || candidate.targets.length === 0) return false;
  return candidate.targets.every(
    (target) => (TARGETS as readonly string[]).includes(target as Target),
  );
}

@Controller('internal')
export class EnqueueController {
  constructor(@Inject(INTAKE_SERVICE) private readonly intake: IntakeService) {}

  @Post('enqueue')
  async enqueue(@Body() body: unknown): Promise<IntakeResult> {
    // A half-formed event must never reach the queue: a bad target would sit
    // there forever with no worker registered for it.
    if (!isIntakeInput(body)) {
      throw new BadRequestException(
        'expected { externalId, kind, payload, targets[] } with known kind and targets',
      );
    }
    return this.intake.accept(body);
  }

  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
