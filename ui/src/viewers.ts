// ui/src/viewers.ts
// How many other people are on the page, worded once so the panel only has to place
// it.
//
// This used to share a file with a badge that said whether the event stream was up.
// The badge is gone. It spent every visit reading "Live" in green, which is a word
// the page had to be believed about and which told a reader nothing they could not
// see from the numbers moving. What it was really for was its other state, and a
// failure that shows up once in a thousand visits is not worth a permanent fixture
// in the corner of the panel.
//
// This half stays, because it is the answer to a question a reader actually has:
// counters climbing while they sit still reads as a script running, and a page whose
// whole argument is that everything on it is real cannot afford that reading.
export function othersHere(viewers: number): string | null {
  const others = Math.max(viewers - 1, 0);
  // Only once there is somebody. "0 others here" is a line about nothing.
  if (others === 0) return null;
  return `${others} other${others === 1 ? '' : 's'} here right now`;
}
