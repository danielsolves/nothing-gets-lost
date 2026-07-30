// services/api/src/deliveries.service.ts
// Reads the recent deliveries and turns them into the running log the visitor sees.
// A failed attempt is phrased with its next retry time on purpose: waiting must read
// as "held", not as "broken" (spec 2).
import type { Pool } from 'pg';
import type { DeliveryState, DeliveryView, Target, TimelineEntry } from '@ngl/contracts';

interface DeliveryRow {
  id: string;
  event_id: string;
  target: Target;
  state: DeliveryState;
  attempts: number;
  next_at: Date | null;
  last_error: string | null;
  remote_ref: string | null;
  remote_at: Date | null;
  updated_at: Date;
}

const LABELS: Record<Target, string> = {
  hubspot: 'HubSpot', stripe: 'Stripe', slack: 'Slack',
  ledger: 'Invoice', mailer: 'Confirmation mail', custom_webhook: 'Your webhook',
};

export class DeliveriesService {
  constructor(private readonly pool: Pool) {}

  async recent(limit: number): Promise<DeliveryView[]> {
    const rows = await this.read(limit);
    return rows.map((row) => this.toView(row));
  }

  async timeline(limit: number): Promise<TimelineEntry[]> {
    const rows = await this.read(limit);
    return rows.map((row) => this.toEntry(row));
  }

  private async read(limit: number): Promise<DeliveryRow[]> {
    const { rows } = await this.pool.query<DeliveryRow>(
      `SELECT id, event_id, target, state, attempts, next_at, last_error,
              remote_ref, remote_at, updated_at
         FROM deliveries ORDER BY updated_at DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  private toView(row: DeliveryRow): DeliveryView {
    return {
      id: Number(row.id),
      eventId: row.event_id,
      target: row.target,
      state: row.state,
      attempts: row.attempts,
      nextAt: row.next_at === null ? null : row.next_at.toISOString(),
      lastError: row.last_error,
      remoteRef: row.remote_ref,
      remoteAt: row.remote_at === null ? null : row.remote_at.toISOString(),
    };
  }

  private toEntry(row: DeliveryRow): TimelineEntry {
    return {
      at: row.updated_at.toISOString(),
      eventId: row.event_id,
      text: `${LABELS[row.target]} — ${this.describe(row)}`,
      level: this.level(row),
    };
  }

  private describe(row: DeliveryRow): string {
    if (row.state === 'done') return `confirmed${row.remote_ref ? ` as ${row.remote_ref}` : ''}`;
    if (row.state === 'dead') {
      return `given up after ${row.attempts} attempts, waiting for a human` +
        `${row.last_error ? `: ${row.last_error}` : ''}`;
    }
    if (row.attempts === 0) return 'queued';
    const next = row.next_at === null ? 'shortly' : row.next_at.toISOString();
    return `attempt ${row.attempts} failed, next try at ${next}` +
      `${row.last_error ? ` (${row.last_error})` : ''}`;
  }

  private level(row: DeliveryRow): TimelineEntry['level'] {
    if (row.state === 'done') return 'success';
    if (row.state === 'dead') return 'error';
    return row.attempts === 0 ? 'info' : 'warn';
  }
}
