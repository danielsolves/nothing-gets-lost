// ui/src/live.ts
// Two facts about the stream, worded once so the panel only has to place them.
//
// Both used to sit in the page header and went out with it, and both were doing a
// job there. The badge was the only thing on the page that said the stream had
// dropped: without it a page whose connection has died looks calm rather than
// broken, and calm is the worse of the two lies. The visitor count explained why
// counters climb while a reader is sitting still, which otherwise reads as a script
// running, and a page arguing that everything on it is real cannot afford that.
//
// They belong to the mediator rather than to the header. The header is read before a
// visitor has decided to care; a readout of the connection is for somebody already
// watching the numbers, and the numbers are in the hub.
export interface LiveState {
  text: string;
  /** `live` while the stream holds, `lost` once it has dropped. */
  tone: 'live' | 'lost';
  /** How many other people are on the page, worded, or null when nobody is. */
  others: string | null;
}

export function liveState(connected: boolean, viewers: number): LiveState {
  const others = Math.max(viewers - 1, 0);
  return {
    text: connected ? 'Live' : 'Connection lost',
    tone: connected ? 'live' : 'lost',
    // Only once there is somebody. "0 others here" is a line about nothing, and the
    // count is only worth printing because it answers a question a reader has:
    // something moved and it was not me.
    others: others === 0
      ? null
      : `${others} other${others === 1 ? '' : 's'} here right now`,
  };
}
