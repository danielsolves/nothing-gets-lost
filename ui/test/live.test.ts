// ui/test/live.test.ts
// Two sentences about the stream. The wording is the whole feature here: a page that
// has stopped receiving must not read as a page with nothing to report.
import { describe, it, expect } from 'vitest';
import { liveState } from '../src/live';

describe('liveState', () => {
  it('says live while the stream holds', () => {
    expect(liveState(true, 1)).toMatchObject({ text: 'Live', tone: 'live' });
  });

  it('names the failure rather than going quiet', () => {
    expect(liveState(false, 1)).toMatchObject({ text: 'Connection lost', tone: 'lost' });
  });

  it('says nothing about other visitors when the reader is alone', () => {
    expect(liveState(true, 1).others).toBeNull();
  });

  it('counts everybody but the reader', () => {
    expect(liveState(true, 3).others).toBe('2 others here right now');
  });

  it('says one other in the singular', () => {
    expect(liveState(true, 2).others).toBe('1 other here right now');
  });

  // The count comes off the wire. A zero, or a server that has not answered yet,
  // must not produce "-1 others here right now".
  it('never counts below nobody', () => {
    expect(liveState(true, 0).others).toBeNull();
  });

  // A dropped stream leaves the last count it heard. Printing it is right: those
  // people are probably still there, and it is the connection that is in doubt,
  // which the badge beside it already says.
  it('still names the others when the stream has dropped', () => {
    expect(liveState(false, 2).others).toBe('1 other here right now');
  });
});
