// services/egress-gate/src/proxy.controller.ts
// Every outbound call goes through here. The switch state is applied on the wire,
// so the mediator experiences a genuine transport failure and cannot tell that
// somebody flipped a switch (spec 7).
//
// "cut" destroys the socket rather than answering — a tidy error body would be a
// stage prop, and this demo exists to not be one.
import {
  All, Controller, Inject, Param, Req, Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SLOW_DELAY_MS, type SwitchState } from '@ngl/contracts';

export const SWITCH_READER = Symbol('SWITCH_READER');
export const BASE_URL_MAP = Symbol('BASE_URL_MAP');

export interface SwitchReader { get(target: string): Promise<SwitchState> }

@Controller()
export class ProxyController {
  constructor(
    @Inject(SWITCH_READER) private readonly switches: SwitchReader,
    @Inject(BASE_URL_MAP) private readonly baseUrls: Record<string, string>,
  ) {}

  @All('proxy/:target/*path')
  async proxy(
    @Param('target') target: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const baseUrl = this.baseUrls[target];
    if (!baseUrl) {
      response.status(404).json({ error: `unknown target "${target}"` });
      return;
    }

    const state = await this.switches.get(target);

    if (state === 'cut') {
      request.socket.destroy();
      return;
    }
    if (state === 'error') {
      response.status(503).json({ error: `${target} unavailable` });
      return;
    }
    if (state === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, SLOW_DELAY_MS));
    }

    const suffix = request.originalUrl.replace(`/proxy/${target}`, '');
    const upstream = await fetch(`${baseUrl}${suffix}`, {
      method: request.method,
      headers: this.forwardableHeaders(request),
      // Byte for byte, never re-encoded. This used to hand on JSON.stringify of the
      // parsed body while forwarding the caller's original content-type. Invisible
      // for the targets that speak JSON, fatal for Stripe, which speaks
      // x-www-form-urlencoded: it received JSON labelled as a form and said 400.
      //
      // The general rule matters more than the one bug. Spec 7 promises the mediator
      // experiences a genuine call, and a proxy that rewrites what it carries is not
      // carrying one.
      body: ['GET', 'HEAD'].includes(request.method)
        ? undefined
        : (request.body as Buffer),
    });

    const text = await upstream.text();
    response.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) response.setHeader('content-type', contentType);
    response.send(text);
  }

  /** Host must not be forwarded — it would point at the gate, not the upstream. */
  private forwardableHeaders(request: Request): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      const lower = key.toLowerCase();
      if (['host', 'connection', 'content-length'].includes(lower)) continue;
      if (typeof value === 'string') headers[lower] = value;
    }
    return headers;
  }
}
