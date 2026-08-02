// services/api/test/mcp-proxy.controller.test.ts
// The one hop between the page and the MCP server.
//
// Everything worth asserting here is about not touching what passes through. The
// panel on the page prints the response body character for character and invites the
// reader to repeat the call with curl against the public /mcp; if this controller
// reformatted, summarised or filtered anything, the two would disagree and the panel
// would be a rendering after all.
//
// The other assertion is the forwarded address. The MCP server meters per caller and
// sees only this container when the api calls it, so without the header one visitor
// could spend the whole window for everybody.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpProxyController, type RawResponse } from '../src/mcp-proxy.controller';

const UPSTREAM = 'http://mcp.test/mcp';

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

let sent: Sent[];
let reply: { status: number; body: string; contentType: string } | Error;

/** Records what the controller wrote, with the shape express gives it. */
class Recorder implements RawResponse {
  statusCode = 0;
  readonly headers: Record<string, string> = {};
  body = '';

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(payload: string): void {
    this.body = payload;
  }
}

function request(payload: string, headers: Record<string, string> = {}) {
  return { ip: '198.51.100.7', headers, rawBody: Buffer.from(payload) };
}

beforeEach(() => {
  sent = [];
  reply = {
    status: 200,
    contentType: 'text/event-stream',
    body: 'event: message\ndata: {"result":{"tools":[]},"jsonrpc":"2.0","id":1}\n\n',
  };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: String(init?.body ?? ''),
    });
    if (reply instanceof Error) throw reply;
    return new Response(reply.body, {
      status: reply.status,
      headers: { 'content-type': reply.contentType },
    });
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('McpProxyController', () => {
  it('posts the bytes it was given, unparsed and unrebuilt', async () => {
    const payload = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
    await new McpProxyController(UPSTREAM).ask(request(payload), new Recorder());

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(UPSTREAM);
    expect(sent[0].method).toBe('POST');
    expect(sent[0].body).toBe(payload);
  });

  it('asks for the event stream the transport answers with', async () => {
    await new McpProxyController(UPSTREAM).ask(request('{}'), new Recorder());
    expect(sent[0].headers.accept).toContain('text/event-stream');
  });

  it('hands the answer back whole, with its status and its content type', async () => {
    const response = new Recorder();
    await new McpProxyController(UPSTREAM).ask(request('{}'), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(response.body).toBe(
      'event: message\ndata: {"result":{"tools":[]},"jsonrpc":"2.0","id":1}\n\n',
    );
  });

  it('passes a refusal through rather than dressing it up as success', async () => {
    reply = { status: 429, contentType: 'application/json', body: '{"error":"Too many requests"}' };
    const response = new Recorder();
    await new McpProxyController(UPSTREAM).ask(request('{}'), response);

    expect(response.statusCode).toBe(429);
    expect(response.body).toBe('{"error":"Too many requests"}');
  });

  // The MCP server meters per caller off this header. Without it every visitor of
  // this page shares one window and the first one closes it for the rest.
  it('forwards the caller so the server still meters per visitor', async () => {
    await new McpProxyController(UPSTREAM).ask(
      request('{}', { 'x-forwarded-for': '203.0.113.9, 10.0.0.2' }), new Recorder(),
    );
    expect(sent[0].headers['x-forwarded-for']).toBe('203.0.113.9, 10.0.0.2');
  });

  it('falls back to the socket address when nothing was forwarded', async () => {
    await new McpProxyController(UPSTREAM).ask(request('{}'), new Recorder());
    expect(sent[0].headers['x-forwarded-for']).toBe('198.51.100.7');
  });

  // A visitor who presses run while the server is down has to be told that, in words
  // the panel can print where the response body it did not get would have been.
  it('answers in plain words when the server cannot be reached', async () => {
    reply = new Error('connect ECONNREFUSED');
    const response = new Recorder();
    await new McpProxyController(UPSTREAM).ask(request('{}'), response);

    expect(response.statusCode).toBe(502);
    expect(response.body).toMatch(/MCP server/i);
  });

  it('refuses a request with no body instead of asking the server about nothing', async () => {
    const response = new Recorder();
    await new McpProxyController(UPSTREAM).ask({ ip: '198.51.100.7', headers: {} }, response);

    expect(response.statusCode).toBe(400);
    expect(sent).toHaveLength(0);
  });
});
