// ui/test/wires.test.ts
// Where a line between the mediator and a system runs.
//
// This is arithmetic on plain numbers precisely so it can be checked here. jsdom
// reports every rectangle as zero, so a test that rendered the diagram and read the
// paths back would assert nothing at all: it would pass on a version that drew every
// line from the origin to the origin.
//
// The assertions are about shape rather than about exact strings where they can be.
// A path is a rendering detail; that a tile which has wrapped underneath the mediator
// is not reached by a line running back through the mediator is not.
import { describe, it, expect } from 'vitest';
import { entryWire, wiresFrom, type Box } from '../src/wires';

const hub: Box = { x: 0, y: 40, width: 300, height: 200 };

/** Every number in a path, in the order it appears. */
function numbers(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

describe('wiresFrom', () => {
  it('draws nothing at all before the box has been measured', () => {
    expect(wiresFrom(null, new Map([['hubspot', hub]]))).toEqual([]);
  });

  it('leaves the mediator from the middle of its outward edge', () => {
    const tile: Box = { x: 400, y: 40, width: 160, height: 120 };
    const [wire] = wiresFrom(hub, new Map([['hubspot', tile]]));
    // The hub spans y 40 to 240, so its midline is 140, and its right edge is 300.
    expect(numbers(wire.d).slice(0, 2)).toEqual([300, 140]);
  });

  it('ends at the near edge of the tile, not inside it', () => {
    const tile: Box = { x: 400, y: 40, width: 160, height: 120 };
    const [wire] = wiresFrom(hub, new Map([['hubspot', tile]]));
    const points = numbers(wire.d);
    // Last horizontal leg lands on the tile's left edge, at its own midline.
    expect(points[points.length - 1]).toBe(400);
  });

  it('turns two right angles rather than cutting across as a diagonal', () => {
    // A diagonal across a grid of tiles crosses the ones it does not belong to.
    const tile: Box = { x: 400, y: 300, width: 160, height: 120 };
    const [wire] = wiresFrom(hub, new Map([['hubspot', tile]]));
    expect(wire.d).toMatch(/^M [\d.]+ [\d.]+ H [\d.]+ V [\d.]+ H [\d.]+$/);
  });

  it('runs straight when the tile happens to sit level with the exit', () => {
    // The middle leg has no length here, and the line should look like what it is.
    const tile: Box = { x: 400, y: 80, width: 160, height: 120 };
    const [wire] = wiresFrom(hub, new Map([['hubspot', tile]]));
    const points = numbers(wire.d);
    // M x y  H turn  V y  H x: the vertical leg goes to the same y it started at.
    expect(points[1]).toBe(points[3]);
  });

  it('comes down into a tile that has wrapped below the mediator', () => {
    // Entered from the left, the line would have to run back through the panel it
    // just left.
    const below: Box = { x: 20, y: 300, width: 160, height: 120 };
    const [wire] = wiresFrom(hub, new Map([['ledger', below]]));
    expect(wire.d).toMatch(/^M [\d.]+ [\d.]+ H [\d.]+ V [\d.]+ H [\d.]+ V [\d.]+$/);
  });

  it('clears the foot of the mediator before crossing back under it', () => {
    const below: Box = { x: 20, y: 300, width: 160, height: 120 };
    const [wire] = wiresFrom(hub, new Map([['ledger', below]]));
    const points = numbers(wire.d);
    // The first vertical leg must pass the hub's bottom edge, which is 240.
    expect(points[3]).toBeGreaterThan(hub.y + hub.height);
  });

  it('comes down onto a tile standing behind another in the same row', () => {
    // Three tiles in a row share a midline. Reached at that midline, the line to the
    // third ran straight through the first two, and a visitor cannot tell a line
    // that connects to a tile from one that merely passes behind it.
    const tiles = new Map<string, Box>([
      ['stripe', { x: 400, y: 40, width: 160, height: 120 }],
      ['hubspot', { x: 580, y: 40, width: 160, height: 120 }],
    ]);
    const [first, second] = wiresFrom(hub, tiles);
    expect(first.d).toMatch(/^M [\d.]+ [\d.]+ H [\d.]+ V [\d.]+ H [\d.]+$/);
    expect(second.d).toMatch(/^M [\d.]+ [\d.]+ H [\d.]+ V [\d.]+ H [\d.]+ V [\d.]+$/);
  });

  it('runs the branch above the row rather than across the tiles in it', () => {
    const tiles = new Map<string, Box>([
      ['stripe', { x: 400, y: 40, width: 160, height: 120 }],
      ['hubspot', { x: 580, y: 40, width: 160, height: 120 }],
    ]);
    const [, second] = wiresFrom(hub, tiles);
    const points = numbers(second.d);
    // The lane it travels along sits above the top edge of the row, which is 40.
    expect(points[3]).toBeLessThan(40);
    expect(points[points.length - 1]).toBe(40);
  });

  it('puts every tile in a row on the same lane, so the route forks once', () => {
    const tiles = new Map<string, Box>([
      ['stripe', { x: 400, y: 40, width: 160, height: 120 }],
      ['hubspot', { x: 580, y: 40, width: 160, height: 120 }],
      ['ledger', { x: 760, y: 40, width: 160, height: 120 }],
    ]);
    const [, second, third] = wiresFrom(hub, tiles);
    expect(numbers(second.d)[3]).toBe(numbers(third.d)[3]);
  });

  it('aims at the middle of the top edge of a tile it comes down onto', () => {
    const below: Box = { x: 20, y: 300, width: 160, height: 120 };
    const [wire] = wiresFrom(hub, new Map([['ledger', below]]));
    const points = numbers(wire.d);
    expect(points[points.length - 2]).toBe(100);
    expect(points[points.length - 1]).toBe(300);
  });

  it('draws one line per tile and names each after its system', () => {
    const tiles = new Map<string, Box>([
      ['hubspot', { x: 400, y: 40, width: 160, height: 120 }],
      ['slack', { x: 400, y: 180, width: 160, height: 120 }],
    ]);
    expect(wiresFrom(hub, tiles).map((wire) => wire.target)).toEqual(['hubspot', 'slack']);
  });

  it('rounds every coordinate, so a one-pixel line stays one pixel', () => {
    // Half-pixel coordinates render as two grey lines rather than one dark one.
    const tile: Box = { x: 400.4, y: 40.3, width: 160.5, height: 121.7 };
    const [wire] = wiresFrom(hub, new Map([['hubspot', tile]]));
    for (const point of numbers(wire.d)) expect(Number.isInteger(point)).toBe(true);
  });
});

describe('entryWire', () => {
  it('draws nothing before the mediator has been measured', () => {
    expect(entryWire(null)).toBeNull();
  });

  it('comes straight down the middle into the top edge of the mediator', () => {
    // The one line that runs the other way: it brings an order in rather than
    // carrying work out, and a visitor seeing a dot on it has watched their own
    // press become an order.
    const wire = entryWire(hub);
    expect(wire?.d).toBe('M 150 0 V 40');
  });

  it('is named for where the order came from', () => {
    expect(entryWire(hub)?.target).toBe('shop');
  });
});
