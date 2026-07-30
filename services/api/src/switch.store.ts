// services/api/src/switch.store.ts
// Reads and writes the switch states for the control panel. Kept in Postgres
// rather than in memory so a restart does not silently repair the demo while a
// visitor is watching — the egress gate reads the very same rows.
import type { Pool } from 'pg';
import {
  SWITCHABLE_TARGETS, type SwitchState, type SwitchableTarget,
} from '@ngl/contracts';

export class SwitchStore {
  constructor(private readonly pool: Pool) {}

  async get(target: SwitchableTarget): Promise<SwitchState> {
    const { rows } = await this.pool.query<{ state: SwitchState }>(
      'SELECT state FROM switches WHERE target = $1', [target],
    );
    return rows[0]?.state ?? 'up';
  }

  async all(): Promise<Record<SwitchableTarget, SwitchState>> {
    const { rows } = await this.pool.query<{ target: SwitchableTarget; state: SwitchState }>(
      'SELECT target, state FROM switches',
    );
    const result = {} as Record<SwitchableTarget, SwitchState>;
    for (const target of SWITCHABLE_TARGETS) result[target] = 'up';
    for (const row of rows) result[row.target] = row.state;
    return result;
  }

  async set(target: SwitchableTarget, state: SwitchState): Promise<void> {
    await this.pool.query(
      'UPDATE switches SET state = $2, changed_at = now() WHERE target = $1',
      [target, state],
    );
  }

  async resetAll(): Promise<void> {
    await this.pool.query(`UPDATE switches SET state = 'up', changed_at = now()`);
  }

  async lastChangeAt(): Promise<Date> {
    const { rows } = await this.pool.query<{ at: Date }>(
      'SELECT max(changed_at) AS at FROM switches',
    );
    return rows[0]?.at ?? new Date(0);
  }
}
