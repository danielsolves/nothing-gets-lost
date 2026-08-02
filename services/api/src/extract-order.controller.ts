// services/api/src/extract-order.controller.ts
// POST /api/extract-order — free text in, a proposal or a refusal out.
//
// It is the only door on this service that spends money when a stranger presses it,
// so almost everything here is about calls that must not be made. A body that is not
// an order mail, a blank field and a pasted book are all refused before the extractor
// is touched, and none of them is charged to the visitor's allowance either: the
// bucket meters model calls, and a call that will not happen has nothing to meter.
//
// There is no confirm endpoint next to this one. A proposal the visitor accepts is
// posted to /api/orders, which is where every order on this page is placed, priced
// and capped. A second way in would be a second set of those rules to keep in step by
// hand, and the first thing to drift would be the one that costs money.
import {
  BadRequestException, Body, Controller, HttpException, HttpStatus, Inject, Post, Req,
} from '@nestjs/common';
import {
  MAX_ORDER_TEXT, type ExtractOrderRequest, type ExtractOrderResponse,
} from '@ngl/contracts';
import { LIMITS, hashIp } from './rate-limit.guard';
import { RATE_LIMITER } from './orders.controller';

export const EXTRACT_ORDER_SERVICE = Symbol('EXTRACT_ORDER_SERVICE');

/**
 * The one method this door needs from the limiter, named for what it is metering.
 * Structural, so main.ts injects the real RateLimiter and a test hands over a stub
 * that counts, without either of them being told about the other.
 */
export interface CallCounter {
  check(bucket: string, subject: string, limit: number): Promise<boolean>;
}

/** Whatever the reader is; the controller only ever asks it to read. */
export interface MailReader {
  read(text: string): Promise<ExtractOrderResponse>;
}

/** The half of an express request this door looks at. */
interface Caller {
  ip?: string;
}

function isExtractOrderRequest(value: unknown): value is ExtractOrderRequest {
  if (typeof value !== 'object' || value === null) return false;
  return 'text' in value && typeof value.text === 'string';
}

@Controller('api')
export class ExtractOrderController {
  // Tokens spelled out: esbuild emits no decorator metadata to infer them from.
  constructor(
    @Inject(EXTRACT_ORDER_SERVICE) private readonly extraction: MailReader,
    @Inject(RATE_LIMITER) private readonly counter: CallCounter,
  ) {}

  @Post('extract-order')
  async read(@Body() body: unknown, @Req() request: Caller): Promise<ExtractOrderResponse> {
    if (!isExtractOrderRequest(body)) {
      throw new BadRequestException('expected { text: string }');
    }

    const text = body.text.trim();
    if (text === '') throw new BadRequestException('There is nothing to read in that.');
    if (text.length > MAX_ORDER_TEXT) {
      throw new BadRequestException(
        `That is longer than ${MAX_ORDER_TEXT} characters, which is longer than an `
        + 'order mail. Shorten it and try again.',
      );
    }

    const within = await this.counter.check(
      'model', hashIp(request.ip ?? 'unknown'), LIMITS.model,
    );
    if (!within) {
      throw new HttpException(
        `That is ${LIMITS.model} mails read this hour from your address. Reading one `
        + 'costs a model call, so this cap is tighter than the one on orders. Try '
        + 'again next hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      // A refused reading comes back as a 200 with `ok: false`. The model being
      // wrong is the thing this page is for, not a fault of the server, and a 500
      // would leave the page with nothing to draw at the moment it matters most.
      return await this.extraction.read(text);
    } catch {
      throw new HttpException(
        'The extractor could not be reached, so nothing was read and nothing was '
        + 'placed. Every order already in the queue is unaffected.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
