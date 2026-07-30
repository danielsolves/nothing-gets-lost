// services/extractor/src/main.ts
// The extractor's only door: POST /internal/extract. It is internal because a
// rejected extraction carries the raw model answer verbatim, which belongs on
// the operator's screen (spec 8.4) and nowhere else.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getPool } from '@ngl/db';
import { ExtractService } from './extract.service';
import { createModel } from './anthropic.model';

const PORT = 3006;
const MAX_BODY_BYTES = 64 * 1024;

interface ExtractRequest {
  text: string;
  hallucinate?: boolean;
}

function isExtractRequest(value: unknown): value is ExtractRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.text !== 'string') return false;
  return candidate.hallucinate === undefined
    || typeof candidate.hallucinate === 'boolean';
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseBody(raw: string): ExtractRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isExtractRequest(parsed) ? parsed : null;
}

function start(): void {
  const extractor = new ExtractService(
    getPool(),
    createModel(process.env.ANTHROPIC_API_KEY),
  );

  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/internal/extract') {
        send(response, 404, { error: 'not found' });
        return;
      }
      try {
        const body = parseBody(await readBody(request));
        if (!body) {
          send(response, 400, { error: 'expected { text: string, hallucinate?: boolean }' });
          return;
        }
        send(response, 200, await extractor.extract(body.text, {
          hallucinate: body.hallucinate,
        }));
      } catch (error) {
        // A failure here is ours, not the model's — a model that answers badly
        // comes back as a rejected extraction with status 200, never as a 500.
        send(response, 500, {
          error: error instanceof Error ? error.message : 'unknown error',
        });
      }
    })();
  });

  server.listen(PORT, '0.0.0.0');
}

start();
