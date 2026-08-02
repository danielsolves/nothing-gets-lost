// packages/contracts/test/extraction.test.ts
// The vocabulary of a reading: which check refused an answer, and how much text a
// visitor may hand to a model.
//
// The check names are the ones the extractor already reports on `ExtractResult`.
// They are pinned rather than translated, because a page that renamed `catalog` to
// something friendlier would be describing a check by a name that appears nowhere in
// the service that ran it, and the first person to read both would have to work out
// that they are the same thing.
import { describe, it, expect } from 'vitest';
import {
  EXTRACTION_CHECKS, isExtractionCheck, MAX_ORDER_TEXT,
} from '../src/index';

describe('the extraction vocabulary', () => {
  it('names the two checks exactly as the extractor reports them', () => {
    expect([...EXTRACTION_CHECKS]).toEqual(['schema', 'catalog']);
  });

  it('recognises a check it knows and refuses one it does not', () => {
    expect(isExtractionCheck('catalog')).toBe(true);
    expect(isExtractionCheck('schema')).toBe(true);
    expect(isExtractionCheck('vibes')).toBe(false);
  });

  it('bounds the text, because every character of it is paid for', () => {
    // The field and the endpoint both read this. A textarea that let a stranger
    // paste a novel into a model would be a bill with a text box in front of it,
    // and a cap only the server knew about would refuse the paste after the fact.
    expect(MAX_ORDER_TEXT).toBeGreaterThan(200);
    expect(MAX_ORDER_TEXT).toBeLessThanOrEqual(2000);
  });
});
