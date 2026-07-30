// services/api/src/sql.service.ts
// The read-only SQL console (spec 9.6).
//
// Four layers, because this is the riskiest surface in the project:
//   1. only one statement
//   2. it must start with SELECT
//   3. a hard row cap
//   4. a database role that is read only and can see four views and nothing else
// Layer four is what actually holds; the first three are there so honest mistakes
// get a readable error instead of a permission failure.
import type { Pool } from 'pg';
import type { SqlResponse } from '@ngl/contracts';

const ROW_CAP = 200;

export class SqlService {
  constructor(private readonly readonlyPool: Pool) {}

  async run(query: string): Promise<SqlResponse> {
    const trimmed = query.trim().replace(/;\s*$/, '');

    if (trimmed.includes(';')) {
      throw new Error('Only one statement at a time.');
    }
    if (!/^select\s/i.test(trimmed)) {
      throw new Error('Only SELECT is allowed here.');
    }

    const result = await this.readonlyPool.query({
      text: `SELECT * FROM (${trimmed}) AS visitor_query LIMIT ${ROW_CAP + 1}`,
      rowMode: 'array',
    });

    const truncated = result.rows.length > ROW_CAP;
    return {
      columns: result.fields.map((field) => field.name),
      rows: (truncated ? result.rows.slice(0, ROW_CAP) : result.rows) as unknown[][],
      rowCount: truncated ? ROW_CAP : result.rows.length,
      truncated,
    };
  }
}
