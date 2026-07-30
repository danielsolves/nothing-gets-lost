// services/api/src/oauth/token.store.ts
// Stores visitor OAuth tokens encrypted, for 24 hours (spec 9.4, 10.1).
//
// AES-256-GCM rather than plain AES: the auth tag means a tampered row fails loudly
// instead of decrypting to garbage. A demo holding somebody else's Slack token has
// to be boringly correct about this.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

const TTL_HOURS = 24;

export class TokenStore {
  constructor(private readonly pool: Pool, private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes');
  }

  async save(
    provider: 'slack' | 'hubspot', token: string, targetRef: string | null,
  ): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    await this.pool.query('DELETE FROM oauth_tokens WHERE provider = $1', [provider]);
    await this.pool.query(
      `INSERT INTO oauth_tokens (provider, encrypted, iv, auth_tag, target_ref, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))`,
      [provider, encrypted, iv, authTag, targetRef, TTL_HOURS],
    );
  }

  async load(
    provider: 'slack' | 'hubspot',
  ): Promise<{ token: string; targetRef: string | null; expiresAt: Date } | null> {
    const { rows } = await this.pool.query<{
      encrypted: Buffer; iv: Buffer; auth_tag: Buffer;
      target_ref: string | null; expires_at: Date;
    }>(
      `SELECT encrypted, iv, auth_tag, target_ref, expires_at
         FROM oauth_tokens WHERE provider = $1 AND expires_at > now()`,
      [provider],
    );

    const row = rows[0];
    if (!row) return null;

    const decipher = createDecipheriv('aes-256-gcm', this.key, row.iv);
    decipher.setAuthTag(row.auth_tag);
    const token = Buffer.concat([
      decipher.update(row.encrypted), decipher.final(),
    ]).toString('utf8');

    return { token, targetRef: row.target_ref, expiresAt: row.expires_at };
  }

  async forget(provider: 'slack' | 'hubspot'): Promise<void> {
    await this.pool.query('DELETE FROM oauth_tokens WHERE provider = $1', [provider]);
  }

  async purgeExpired(): Promise<number> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM oauth_tokens WHERE expires_at <= now()',
    );
    return rowCount ?? 0;
  }
}
