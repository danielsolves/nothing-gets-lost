// ui/src/useWires.ts
// Measures the mediator and every system tile, and hands back the paths between them.
//
// The measuring is the whole reason this exists. The tiles wrap, the mediator grows
// as its queue fills, and the whole box reflows at three breakpoints, so where a line
// has to run is not knowable until the browser has laid the page out. A ResizeObserver
// on the box catches the reflows; a second one on the mediator catches it growing
// without the box changing size at all, which is the common case here because the
// queue gains a row every time an order lands.
//
// jsdom reports every rectangle as zero, so the tests for the shape live on wires.ts
// where they are arithmetic. What comes back here is one wire per system either way:
// the list of lines is a fact about the machine, and only where each one runs is a
// fact about the layout. That separation is why the state a line carries can still
// be asserted without a browser.
import { useCallback, useEffect, useRef, useState } from 'react';
import { entryWire, wiresFrom, type Box, type Wire } from './wires';

function boxOf(element: Element, origin: DOMRect): Box {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x - origin.x,
    y: rect.y - origin.y,
    width: rect.width,
    height: rect.height,
  };
}

export interface WireLayer {
  /** Put this on the element the lines are drawn inside. */
  frameRef: (element: HTMLElement | null) => void;
  /** Put this on the mediator. */
  hubRef: (element: HTMLElement | null) => void;
  /** Put this on the button an order is sent from, so the way in hangs under it. */
  entryRef: (element: HTMLElement | null) => void;
  /** Put this on each tile, keyed by the system it stands for. */
  tileRef: (target: string) => (element: HTMLElement | null) => void;
  wires: Wire[];
  size: { width: number; height: number };
}

export function useWires(targets: readonly string[]): WireLayer {
  const frame = useRef<HTMLElement | null>(null);
  const hub = useRef<HTMLElement | null>(null);
  const entry = useRef<HTMLElement | null>(null);
  const tiles = useRef(new Map<string, HTMLElement>());

  /**
   * One wire per system whether or not it has been measured yet, plus the way in.
   *
   * The list does not depend on the measuring, only the paths do. A wire that
   * appeared once the browser had laid the page out would mean the drawing has two
   * shapes, one of them briefly, and it would mean the state a line carries is only
   * assertable in a real browser. An unmeasured path is the empty string, which
   * draws nothing and says nothing.
   */
  const withPaths = useCallback(
    (pathFor: (target: string) => string, entry: string): Wire[] => [
      { target: 'shop', d: entry },
      ...targets.map((target) => ({ target, d: pathFor(target) })),
    ],
    [targets],
  );

  const [wires, setWires] = useState<Wire[]>(() => withPaths(() => '', ''));
  const [size, setSize] = useState({ width: 0, height: 0 });

  const measure = useCallback(() => {
    const frameElement = frame.current;
    const hubElement = hub.current;
    if (frameElement === null || hubElement === null) return;

    const origin = frameElement.getBoundingClientRect();
    // A frame with no width has not been laid out yet. Measuring it produces a
    // drawing where every line starts and ends at the same point, which flashes
    // across the box on the first paint.
    if (origin.width === 0) return;

    const boxes = new Map<string, Box>();
    for (const target of targets) {
      const element = tiles.current.get(target);
      if (element !== undefined) boxes.set(target, boxOf(element, origin));
    }

    const hubBox = boxOf(hubElement, origin);
    // The button sits above the frame, so its box has a negative y here. Only its
    // horizontal middle is wanted, which is why that does not matter.
    // The anchor inside, not the wrapper. The wrapper holds the whole order builder
    // once it is open, so its middle is the middle of a two-column form rather than
    // the middle of the button that sends the order.
    const anchor = entry.current?.querySelector('[data-wire-anchor]') ?? entry.current;
    const from = anchor === null ? null : boxOf(anchor, origin);
    const way = entryWire(hubBox, from);
    const measured = new Map(wiresFrom(hubBox, boxes).map((wire) => [wire.target, wire.d]));
    setSize({ width: origin.width, height: origin.height });
    setWires(withPaths((target) => measured.get(target) ?? '', way?.d ?? ''));
  }, [targets, withPaths]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    if (frame.current !== null) observer.observe(frame.current);
    if (hub.current !== null) observer.observe(hub.current);
    if (entry.current !== null) observer.observe(entry.current);
    for (const element of tiles.current.values()) observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [measure]);

  const frameRef = useCallback((element: HTMLElement | null) => {
    frame.current = element;
  }, []);

  const hubRef = useCallback((element: HTMLElement | null) => {
    hub.current = element;
  }, []);

  const entryRef = useCallback((element: HTMLElement | null) => {
    entry.current = element;
  }, []);

  const tileRef = useCallback(
    (target: string) => (element: HTMLElement | null) => {
      if (element === null) tiles.current.delete(target);
      else tiles.current.set(target, element);
    },
    [],
  );

  return { frameRef, hubRef, entryRef, tileRef, wires, size };
}
