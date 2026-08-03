// ui/src/mail-order-answer.ts
// What the two endpoints behind the mail panel are allowed to have answered.
//
// A response body is `unknown` however confident the caller is, and the panel elsewhere
// on this page settles that by naming the type it wants and moving on. That is
// defensible for a body with two string fields. It is not defensible for this one:
// the reading is a union, the whole panel branches on `ok`, and a body that was
// something else would be drawn as a proposal with no basket and a total of nothing,
// which is a page about reliability quietly rendering a hole.
//
// The same guard runs on the api's own hop to the extractor, one process earlier, for
// the same reason. Checking it twice costs a few microseconds and means neither end
// is taking the other's word for the shape of the one answer here that started life
// as a sentence.
import type {
  ExtractOrderResponse, OrderLine, PlaceOrderResponse, ProposedOrder,
} from '@ngl/contracts';
import { isExtractionCheck } from '@ngl/contracts';

function isLine(value: unknown): value is OrderLine {
  if (typeof value !== 'object' || value === null) return false;
  return 'sku' in value && typeof value.sku === 'string'
    && 'name' in value && typeof value.name === 'string'
    && 'qty' in value && typeof value.qty === 'number'
    && 'cents' in value && typeof value.cents === 'number';
}

function isProposal(value: unknown): value is ProposedOrder {
  if (typeof value !== 'object' || value === null) return false;
  if (!('customerName' in value) || typeof value.customerName !== 'string') return false;
  if (!('customerEmail' in value) || typeof value.customerEmail !== 'string') return false;
  if (!('notes' in value)) return false;
  if (value.notes !== null && typeof value.notes !== 'string') return false;
  if (!('totalCents' in value) || typeof value.totalCents !== 'number') return false;
  return 'lines' in value && Array.isArray(value.lines) && value.lines.every(isLine);
}

export function isExtractOrderResponse(value: unknown): value is ExtractOrderResponse {
  if (typeof value !== 'object' || value === null) return false;
  if (!('mode' in value) || (value.mode !== 'live' && value.mode !== 'recorded')) return false;
  if (!('ok' in value) || !('raw' in value)) return false;

  if (value.ok === true) return 'proposal' in value && isProposal(value.proposal);
  if (value.ok !== false) return false;
  if (!('detail' in value) || typeof value.detail !== 'string') return false;
  return 'stoppedBy' in value && typeof value.stoppedBy === 'string'
    && isExtractionCheck(value.stoppedBy);
}

export function isPlaceOrderResponse(value: unknown): value is PlaceOrderResponse {
  if (typeof value !== 'object' || value === null) return false;
  return 'eventId' in value && typeof value.eventId === 'string'
    && 'orderId' in value && typeof value.orderId === 'string';
}
