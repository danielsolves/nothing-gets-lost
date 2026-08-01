// ui/src/wires.ts
// Where the line between the mediator and a system runs, in the coordinates of the
// box that holds them both.
//
// The lines used to be CSS: a strip between each tile and the hub, growing to fill
// whatever space was left. That worked while the drawing was three fixed columns and
// stopped working the moment the systems were allowed to wrap, because a strip
// cannot bend and a tile on the second row needs the line to turn a corner.
//
// So the geometry is measured rather than declared. Every path starts at the same
// point, the middle of the mediator's outward edge, and ends at the near edge of one
// tile. Between them it goes out, along, and in: two right angles rather than a
// diagonal, because a diagonal across a grid of tiles crosses the ones it does not
// belong to, and because right angles are what a wiring diagram looks like.
//
// Kept out of the component so the shape can be checked without a browser. Everything
// here is arithmetic on plain numbers.

/** A rectangle in the coordinate space of the box, not the viewport. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Wire {
  target: string;
  /** An SVG path, ready for `d`. */
  d: string;
}

/** The point a line leaves the mediator from: the middle of its right-hand edge. */
function exitOf(hub: Box): { x: number; y: number } {
  return { x: hub.x + hub.width, y: hub.y + hub.height / 2 };
}

/**
 * Whether some other tile stands between this one and the mediator.
 *
 * The tiles sit in rows, so three of them share a midline. Reaching all three at
 * that midline drew one horizontal line straight through the first two on the way to
 * the third, and a line crossing a tile it does not belong to is exactly the kind of
 * thing this drawing cannot afford: a visitor cannot tell whether it connects to the
 * tile it crosses or merely passes behind it.
 */
function shadowed(tile: Box, others: Iterable<Box>): boolean {
  for (const other of others) {
    if (other === tile) continue;
    if (other.x >= tile.x) continue;
    const overlaps = other.y < tile.y + tile.height && other.y + other.height > tile.y;
    if (overlaps) return true;
  }
  return false;
}

/**
 * Which edge of a tile the line should reach, and from which side.
 *
 * The near edge wherever the line can get there without crossing anything: the left
 * edge for a tile beside the mediator, the top edge for one that has wrapped
 * underneath it or that stands behind another tile in its row.
 */
function entryOf(
  hub: Box, tile: Box, others: Iterable<Box>,
): { x: number; y: number; from: 'left' | 'top' } {
  const beside = tile.x >= hub.x + hub.width;
  if (beside && !shadowed(tile, others)) {
    return { x: tile.x, y: tile.y + tile.height / 2, from: 'left' };
  }
  return { x: tile.x + tile.width / 2, y: tile.y, from: 'top' };
}

/**
 * How far above a tile the line runs before it turns down into it.
 *
 * A fixed lane rather than half the gap, so every branch in a row lands on the same
 * line and the route reads as one thing that forks rather than as three lines that
 * happen to run near each other.
 *
 * 17 against a 34px row gap puts the lane in the middle of the corridor. At 13 in a
 * 16px gap it cleared the tile above by three pixels, which measures as no overlap
 * and looks like one: at that distance a line and a border are one thick edge.
 */
const LANE = 17;

/**
 * No wire runs above the top of the mediator.
 *
 * Everything here leaves the mediator, so a line that climbs over its roof to get
 * somewhere has left the shape of the machine: it reads as a route arriving from
 * above rather than as one going out sideways. The first row of tiles is set below
 * the mediator's top edge to leave a corridor for the lane, and this is the rule
 * that corridor exists to satisfy.
 */
function laneFor(hub: Box, tile: Box): number {
  const wanted = tile.y - LANE;
  const belowHubTop = Math.max(wanted, hub.y);
  // A tile that has wrapped under the mediator is reached round its foot instead,
  // so its lane is clamped from the other side.
  if (tile.x < hub.x + hub.width) return Math.max(hub.y + hub.height + STUB, wanted);
  return belowHubTop;
}

/**
 * How far out of the mediator a line runs before it turns. A fixed stub rather than
 * half the gap: the gap changes with the viewport, and a turn that slides around as
 * the window resizes reads as the drawing being unsure where its own corners are.
 */
const STUB = 18;

/**
 * One path per tile.
 *
 * Rounded corners are deliberate and small. A right angle drawn sharp at this weight
 * aliases into a dark pixel that reads as a dot sitting on the corner, which is the
 * one thing on this page a dot must never be: a dot means a delivery moved.
 */
export function wiresFrom(hub: Box | null, tiles: Map<string, Box>): Wire[] {
  if (hub === null) return [];
  const exit = exitOf(hub);
  const wires: Wire[] = [];

  const boxes = [...tiles.values()];

  for (const [target, tile] of tiles) {
    const entry = entryOf(hub, tile, boxes);
    const turn = round(exit.x + STUB);

    if (entry.from === 'left') {
      // Out, up or down to the tile's height, then in. When the tile happens to sit
      // level with the exit the middle leg has no length and this is a straight line,
      // which is what it should look like.
      wires.push({
        target,
        d: `M ${round(exit.x)} ${round(exit.y)}`
          + ` H ${turn}`
          + ` V ${round(entry.y)}`
          + ` H ${round(entry.x)}`,
      });
      continue;
    }

    // Entered from above. Out to the stub, along to the lane that runs over the
    // tile's own row, across to sit above it, and down into its top edge. Tiles in
    // the same row share the lane, so the route reads as one line that forks rather
    // than as several that happen to run alongside each other.
    //
    // The lane is clamped below the mediator's foot when the tile has wrapped
    // underneath it, so the line goes around the panel rather than back over it.
    const lane = round(laneFor(hub, tile));
    wires.push({
      target,
      d: `M ${round(exit.x)} ${round(exit.y)}`
        + ` H ${turn}`
        + ` V ${lane}`
        + ` H ${round(entry.x)}`
        + ` V ${round(entry.y)}`,
    });
  }

  return wires;
}

/**
 * The line an arriving order travels: from the button that sends it, straight down
 * into the mediator's top edge.
 *
 * It is drawn separately from the others because it is the only one that runs the
 * other way. Every wire above leaves the mediator carrying work outwards; this one
 * brings work in, and a visitor who sees a dot on it has just watched their own
 * press become an order.
 *
 * It hangs under the button rather than under the middle of the mediator. Centred on
 * the panel it was a line starting in empty space, which says a delivery comes from
 * somewhere up there; under the button it says pressing this puts something in here,
 * which is the one thing a visitor has to understand before anything else.
 *
 * @param from the button's box, when it has been measured. Without it the line falls
 *   back to the middle of the mediator, which is wrong but never absent: a machine
 *   drawn with no way in at all is the worse of the two.
 */
export function entryWire(hub: Box | null, from?: Box | null): Wire | null {
  if (hub === null) return null;
  const x = round(from ? from.x + from.width / 2 : hub.x + hub.width / 2);
  return { target: 'shop', d: `M ${x} 0 V ${round(hub.y)}` };
}

/**
 * Half-pixel coordinates make a one-pixel line render as two grey ones. Rounding at
 * the edge of the module rather than at every call site keeps the arithmetic above
 * readable.
 */
function round(value: number): number {
  return Math.round(value);
}
