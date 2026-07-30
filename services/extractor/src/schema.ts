// services/extractor/src/schema.ts
// The shape a model answer must have (spec 8.2). additionalProperties: false is
// load-bearing: without it a model can attach an invented discount field and the
// answer still validates.
import { z } from 'zod';

export const orderSchema = z.object({
  customer: z.object({
    name: z.string().min(1),
    email: z.string().email(),
  }).strict(),
  items: z.array(
    z.object({
      sku: z.string().min(1),
      qty: z.number().int().min(1),
    }).strict(),
  ).min(1),
  notes: z.string().nullable(),
}).strict();

export type ExtractedOrder = z.infer<typeof orderSchema>;

export const SYSTEM_PROMPT = `You turn a free-form order email into structured data.
Answer with JSON only, no prose, matching exactly this shape:
{"customer":{"name":string,"email":string},
 "items":[{"sku":string,"qty":integer}],
 "notes":string|null}
Use only SKUs from the catalogue you are given. Never invent one.`;
