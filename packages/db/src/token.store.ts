// packages/db/src/token.store.ts
// Stores visitor OAuth tokens encrypted, for 24 hours (spec 9.4, 10.1).
//
// AES-256-GCM rather than plain AES: the auth tag means a tampered row fails loudly
// instead of decrypting to garbage. A demo holding somebody else's Slack token has
// to be boringly correct about this.
//
// It sits in @ngl/db because two services need it: the api writes the token when the
// visitor finishes the OAuth flow, and the mediator reads it on every delivery. The
// alternative was an internal endpoint on the api, which would have put a network hop
// into the delivery path and made the queue depend on the api being up. A project
// about what breaks between two systems should not add a line it does not need.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

const TTL_HOURS = 24;

export type TokenProvider = 'slack' | 'hubspot';

/**
 * Without a configured key the demo still has to start — five of the ten proofs need
 * no connection at all. It runs on a key that dies with the process instead: stored
 * connections then end at the next restart rather than after 24 hours, which is the
 * safe direction to be wrong in. Production sets the variable.
 *
 * api and mediator read this independently. Unset, they end up with different keys and
 * the mediator cannot read what the api wrote — which is why the mediator treats an
 * undecryptable row as "not connected" and keeps the house credentials rather than
 * failing the delivery.
 */
export function tokenKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer {
  const configured = env.TOKEN_ENCRYPTION_KEY;
  if (!configured) {
    console.warn(
      'TOKEN_ENCRYPTION_KEY is not set — using a key that dies with this process. ' +
      'Visitor connections will not survive a restart.',
    );
    return randomBytes(32);
  }
  return Buffer.from(configured, 'base64');
}

export class TokenStore {
  constructor(private readonly pool: Pool, private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes');
  }

  async save(
    provider: TokenProvider, token: string, targetRef: string | null,
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
    provider: TokenProvider,
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

  async forget(provider: TokenProvider): Promise<void> {
    await this.pool.query('DELETE FROM oauth_tokens WHERE provider = $1', [provider]);
  }

  async purgeExpired(): Promise<number> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM oauth_tokens WHERE expires_at <= now()',
    );
    return rowCount ?? 0;
  }
}
