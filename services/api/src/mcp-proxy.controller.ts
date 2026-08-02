// services/api/src/mcp-proxy.controller.ts
// POST /api/mcp, the one hop between the page and the MCP server: bytes in and bytes
// out.
//
// The MCP panel lets a reader run a tool from the page and prints the answer exactly
// as it arrived. The browser cannot fetch the MCP server itself in a checkout: it
// listens on a port of its own, and only the public host maps /mcp onto it, so on a
// clone started with `docker compose up` the page is on one port and the server on
// another with nothing joining them. The alternatives were to write the MCP port into
// the built page, which is one number that is wrong on every host that moves it, and
// to leave the console working on the live site and dead everywhere else, which would
// demonstrate nothing to anybody reading the repository.
//
// So it relays, and it relays without opinions. The raw request body is forwarded
// unparsed and the response is returned with its own status and content type, because
// the panel invites the reader to repeat the same call with curl against the public
// /mcp and compare: anything reformatted here would make the two disagree.
//
// It filters no method and no tool name. The guarantee already holds where it
// matters: the server behind this has no tool that writes and connects as ngl_ro,
// which could not write if one existed. A filter here would be a second description
// of that, and two descriptions of one guarantee are a way for them to drift apart.
// This adds no capability either. The same server answers the same questions at /mcp
// on the public host, to anyone, without going through here.
import { Controller, Inject, Post, Req, Res } from '@nestjs/common';

export const MCP_UPSTREAM = Symbol('MCP_UPSTREAM');

/** Ten seconds. A read-only query that has not answered by then is not going to. */
const TIMEOUT_MS = 10_000;

const BAD_REQUEST = 400;
const BAD_GATEWAY = 502;

/**
 * What the relay needs from the incoming request: the bytes as they arrived, and
 * enough to say who is calling.
 *
 * Named as the three members rather than typed as the whole express request, the way
 * StreamController does it, so the relay can be exercised without standing up a
 * socket.
 */
export interface RelayedRequest {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  /** Set by Nest because the app is created with `rawBody: true`. */
  rawBody?: Buffer;
}

/** The three things written back. Same reason: no socket needed to test it. */
export interface RawResponse {
  status(code: number): RawResponse;
  setHeader(name: string, value: string): void;
  send(body: string): void;
}

@Controller('api')
export class McpProxyController {
  // Token spelled out: esbuild emits no decorator metadata to infer it from.
  constructor(@Inject(MCP_UPSTREAM) private readonly upstream: string) {}

  @Post('mcp')
  async ask(@Req() request: RelayedRequest, @Res() response: RawResponse): Promise<void> {
    const body = request.rawBody;
    if (body === undefined || body.length === 0) {
      answer(response, BAD_REQUEST, 'application/json',
        JSON.stringify({ error: 'Expected a JSON-RPC request body' }));
      return;
    }

    try {
      const upstream = await fetch(this.upstream, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Both, because the streamable transport picks the shape of its reply from
          // this header and answers an event stream for a call like the panel's.
          accept: 'application/json, text/event-stream',
          // The MCP server meters per caller off this header and would otherwise see
          // this container for every visitor, so the first one would close the window
          // for the rest.
          'x-forwarded-for': callerOf(request),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      answer(response, upstream.status,
        upstream.headers.get('content-type') ?? 'text/plain',
        await upstream.text());
    } catch (error) {
      // Said in words the panel can print where the response body would have been. A
      // silent 500 would leave a reader unable to tell a broken demo from an empty
      // backlog.
      console.error('[api] mcp relay failed', error);
      answer(response, BAD_GATEWAY, 'application/json', JSON.stringify({
        error: 'The MCP server did not answer. Nothing was read and nothing changed.',
      }));
    }
  }
}

function answer(
  response: RawResponse, status: number, contentType: string, body: string,
): void {
  response.status(status);
  response.setHeader('content-type', contentType);
  response.send(body);
}

/**
 * Who is calling. Behind nginx every request arrives from the proxy, so the forwarded
 * chain is the only thing that tells two callers apart; the socket address is what is
 * left when nobody set one. Passed on whole, because the MCP server reads the first
 * entry itself and re-deciding that here would be the same rule in two places.
 */
function callerOf(request: RelayedRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  const chain = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return chain ?? request.ip ?? 'unknown';
}
