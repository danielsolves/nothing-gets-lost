// ui/src/Tabs.tsx
// A strip of tabs with one bar under it, and the panels it slides between.
//
// This was the integration hub's own markup, and the order box had a second pair of
// tabs that were pills. Two controls doing the same job in two shapes read as two
// ideas rather than one, so there is one of them now and the order box is visibly
// the same machine as the hub below it.
//
// The bar is measured rather than assumed. The labels are different lengths, and a
// bar told to travel a guessed distance arrives beside a tab instead of under it. It
// is measured again on resize, because the labels sit at a fixed size in a monospace
// face while the panel around them is fluid.
//
// The panels are laid over each other and moved sideways rather than swapped out. A
// panel unmounted when its tab loses focus has nowhere to travel from, and it takes
// its state with it: on the mail path that state is a reading the visitor pressed a
// button to get.
//
// Two ways of taking a height, because the two callers want opposite things. The hub
// is a window onto a list that must not change size every time an order arrives, so
// it takes its height from the stylesheet and the panel scrolls inside it. The order
// box has two panes of very different heights and no scroll of its own, so it
// measures the pane on screen and grows to it. Laid over each other unmeasured, the
// taller pane would set the height of both and the article path would carry the empty
// space of a mail it is not showing.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** One tab and whatever stands behind it. */
export interface TabSpec<K extends string> {
  key: K;
  label: string;
  /** Drawn on the tab itself, for a count that has to be read while the panel is shut. */
  badge?: ReactNode;
  panel: ReactNode;
}

/**
 * Every id and test hook is built from these two, so each strip keeps the names it
 * already had rather than the component imposing one scheme on both callers.
 */
interface Named {
  /** For example "hub-tab", giving hub-tab-queue and hub-tab-underline. */
  tabPrefix: string;
  /** For example "hub-panel", giving hub-panel-queue. */
  panelPrefix: string;
}

export function TabStrip<K extends string>(props: Named & {
  tabs: TabSpec<K>[];
  current: K;
  onPick: (key: K) => void;
  /** What the choice is about, for a reader who cannot see the strip. */
  label: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const list = strip.current;
    if (!list) return undefined;
    const measure = () => {
      const selected = list.querySelector<HTMLElement>('[aria-selected="true"]');
      if (selected) setBar({ left: selected.offsetLeft, width: selected.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [props.current]);

  return (
    <div className="tab-strip" role="tablist" aria-label={props.label} ref={strip}>
      {props.tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          id={`${props.tabPrefix}-${tab.key}`}
          data-testid={`${props.tabPrefix}-${tab.key}`}
          aria-selected={props.current === tab.key}
          aria-controls={`${props.panelPrefix}-${tab.key}`}
          onClick={() => props.onPick(tab.key)}
        >
          {tab.label}
          {tab.badge}
        </button>
      ))}

      {/* Decorative: the tabs already say which one is selected, to a screen reader
          and to the eye. This only makes the change legible as one movement. */}
      <span
        className="tab-underline"
        data-testid={`${props.tabPrefix}-underline`}
        data-for={props.current}
        aria-hidden="true"
        style={{ transform: `translateX(${bar.left}px)`, width: `${bar.width}px` }}
      />
    </div>
  );
}

export function TabPanels<K extends string>(props: Named & {
  tabs: TabSpec<K>[];
  current: K;
  /**
   * `window` is a frame of a fixed size that the panel scrolls inside. `content`
   * grows to whichever pane is on screen and eases between the two heights.
   */
  fit: 'window' | 'content';
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState<number | null>(null);
  const at = props.tabs.findIndex((tab) => tab.key === props.current);

  useLayoutEffect(() => {
    if (props.fit !== 'content') return undefined;
    const box = wrap.current;
    if (!box) return undefined;
    const measure = () => {
      const live = box.querySelector<HTMLElement>('[data-current="true"]');
      // A zero is never taken. Both a folded box and a test renderer report one, and
      // a pane that cannot be measured is not a pane that is empty: clipping it to
      // nothing would hide content that is merely not laid out yet.
      if (live && live.offsetHeight > 0) setTall(live.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const pane of box.children) observer.observe(pane);
    return () => observer.disconnect();
  }, [props.fit, props.current, props.tabs.length]);

  return (
    <div
      className="tab-panels"
      data-fit={props.fit}
      data-tab={props.current}
      ref={wrap}
      style={props.fit === 'content' && tall !== null ? { height: `${tall}px` } : undefined}
    >
      {props.tabs.map((tab, index) => (
        <div
          key={tab.key}
          className="tab-panel"
          id={`${props.panelPrefix}-${tab.key}`}
          data-testid={`${props.panelPrefix}-${tab.key}`}
          data-current={index === at ? 'true' : 'false'}
          aria-hidden={index === at ? undefined : 'true'}
          role="tabpanel"
          aria-labelledby={`${props.tabPrefix}-${tab.key}`}
          style={{ transform: `translateX(${parked(index, at)})` }}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}

/**
 * Each panel waits on the side it sits on in the strip, so the travel matches the
 * direction the reader's eye has just gone. Worked out from the position rather than
 * written into the stylesheet per pair: with three tabs the middle one has to be able
 * to leave in either direction, which a static rule cannot say.
 */
function parked(index: number, at: number): string {
  if (index === at) return '0';
  return index < at ? '-100%' : '100%';
}
