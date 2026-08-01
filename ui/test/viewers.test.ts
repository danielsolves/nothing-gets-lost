// ui/test/viewers.test.ts
// One sentence about who else is here. The wording is the whole feature: it exists
// to answer a question the reader already has, and it must not appear when there is
// nobody to answer it about.
import { describe, it, expect } from 'vitest';
import { othersHere } from '../src/viewers';

describe('othersHere', () => {
  it('says nothing when the reader is alone', () => {
    expect(othersHere(1)).toBeNull();
  });

  it('counts everybody but the reader', () => {
    expect(othersHere(3)).toBe('2 others here right now');
  });

  it('says one other in the singular', () => {
    expect(othersHere(2)).toBe('1 other here right now');
  });

  // The count comes off the wire. A zero, or a server that has not answered yet,
  // must not produce "-1 others here right now".
  it('never counts below nobody', () => {
    expect(othersHere(0)).toBeNull();
  });
});
