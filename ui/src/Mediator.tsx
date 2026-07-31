// ui/src/Mediator.tsx
// The hub as a panel rather than a caption: its own live counts, the queue it is
// holding, and the log of what it just did.
//
// The specification calls the mediator the heart of the repo and defends building
// the queue by hand with "take a ready-made one and the most interesting part
// becomes invisible". A box captioned "queue · retry · exactly once" made it
// invisible anyway. Everything a visitor would otherwise have to take on faith now
// lives inside it.
//
// The explanation of what a mediator even is sits behind a question mark. It is the
// one thing on this panel that never changes, so it should not compete every second
// with the numbers that do.
//
// What it is doing right now sits outside the tabs, because a visitor who never
// opens the Log reads four numbers with no verb among them and cannot tell a busy
// machine from a stopped one. Counters say how much; this says what.
import { useLayoutEffect, useRef, useState } from 'react';
import type { Counters, DeliveryView, OrderView, TimelineEntry } from '@ngl/contracts';
import { currentWork } from './activity';
import { Queue } from './Queue';
import { Timeline } from './Timeline';

type Tab = 'queue' | 'log';

export function Mediator(props: {
  counters: Counters;
  deliveries: DeliveryView[];
  orders: OrderView[];
  timeline: TimelineEntry[];
  openOrder: string | null;
  onToggleOrder: (eventId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('queue');
  const [help, setHelp] = useState(false);
  const doing = currentWork(props.deliveries);
  const tabs = useRef<HTMLDivElement>(null);
  // Where the underline has to be. Measured rather than assumed: the two labels are
  // different lengths, and a bar that travelled a guessed distance would arrive next
  // to the tab instead of under it. Re-measured on resize because the labels are set
  // in a monospace face at a fixed size but the panel around them is fluid.
  const [bar, setBar] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const list = tabs.current;
    if (!list) return undefined;
    const measure = () => {
      const selected = list.querySelector<HTMLElement>('[aria-selected="true"]');
      if (selected) setBar({ left: selected.offsetLeft, width: selected.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [tab]);

  return (
    <section className="mediator" data-testid="mediator">
      <header className="mediator-head">
        <span className="mediator-titles">
          <span className="mediator-title">The mediator</span>
          <span className="mediator-sub">everything goes through here</span>
        </span>

        {/* The reset came up from the drawer at the bottom of the page along with
            everything else that used to live there. It belongs beside the counters
            it puts back to zero. */}
        <button
          type="button"
          className="mediator-reset"
          data-testid="reset-all"
          onClick={() => void fetch('/api/reset', { method: 'POST' })}
        >
          Reset
        </button>

        <span className="mediator-help-anchor">
          <button
            type="button"
            className="mediator-help-toggle"
            data-testid="hub-help-toggle"
            aria-label="What does the mediator do?"
            aria-expanded={help}
            onClick={() => setHelp((open) => !open)}
            onMouseEnter={() => setHelp(true)}
            onMouseLeave={() => setHelp(false)}
            onFocus={() => setHelp(true)}
            onBlur={() => setHelp(false)}
          >
            ?
          </button>

          {help && (
            <span className="mediator-help" data-testid="hub-help" role="note">
              <b>What it does</b>
              <ul>
                <li>Writes every order down before touching any other system</li>
                <li>Delivers to each system separately, so one failure blocks nothing</li>
                <li>Retries a failed delivery with a growing gap, six times</li>
                <li>Lands each delivery exactly once, even if it dies mid-call</li>
                <li>Parks what it cannot deliver for a human, rather than dropping it</li>
              </ul>
            </span>
          )}
        </span>
      </header>

      <div className="mediator-counts">
        <span className="mediator-count" data-tone="wait">
          <b data-testid="hub-waiting">{props.counters.waiting}</b>
          <i>waiting</i>
        </span>
        <span className="mediator-count" data-tone="done">
          <b>{props.counters.delivered}</b>
          <i>delivered</i>
        </span>
        <span className="mediator-count" data-tone="human">
          <b>{props.counters.needsHuman}</b>
          <i>needs a human</i>
        </span>
        <span className="mediator-count" data-tone="lost">
          <b data-testid="hub-lost">{props.counters.lost}</b>
          <i>lost</i>
        </span>

        {/* Only once there is one, because it is the answer to a question nobody has
            asked yet: a visitor flips "Deliver the payment twice" on the Stripe tile
            and this is the only place on the page that shows the second one being
            thrown away. It carries no colour, unlike the four beside it. Those say
            how the work is going; this one says the machine held its rule. */}
        {props.counters.duplicatesDropped > 0 && (
          <span className="mediator-count">
            <b data-testid="hub-duplicates">{props.counters.duplicatesDropped}</b>
            <i>
              {props.counters.duplicatesDropped === 1
                ? 'duplicate dropped'
                : 'duplicates dropped'}
            </i>
          </span>
        )}
      </div>

      <p className="mediator-doing" data-testid="hub-doing" data-tone={doing.tone}>
        {doing.text}
      </p>

      <div
        className="mediator-tabs"
        role="tablist"
        aria-label="What the mediator holds"
        ref={tabs}
      >
        <button
          type="button"
          role="tab"
          id="hub-tab-queue"
          data-testid="hub-tab-queue"
          aria-selected={tab === 'queue'}
          aria-controls="hub-panel-queue"
          onClick={() => setTab('queue')}
        >
          Order queue
        </button>
        <button
          type="button"
          role="tab"
          id="hub-tab-log"
          data-testid="hub-tab-log"
          aria-selected={tab === 'log'}
          aria-controls="hub-panel-log"
          onClick={() => setTab('log')}
        >
          Log
        </button>

        {/* Decorative: the tabs already say which is selected, to a screen reader
            and to the eye. This only makes the change legible as one movement. */}
        <span
          className="mediator-tab-underline"
          data-testid="hub-tab-underline"
          data-for={tab}
          aria-hidden="true"
          style={{ transform: `translateX(${bar.left}px)`, width: `${bar.width}px` }}
        />
      </div>

      {/* Both panels, laid over each other and moved sideways, rather than one of
          them swapped for the other. A panel that is unmounted when its tab loses
          focus has nowhere to travel from, and the swap made the two tabs read as
          two places instead of two views of one thing.

          The window is only as tall as it needs to be for the panel on show, so the
          height is carried out here and the panels inside it fill whatever it is. */}
      <div
        className="mediator-panels"
        data-tab={tab}
        data-open={tab === 'queue' && props.openOrder ? 'true' : undefined}
      >
        <div
          className="mediator-panel"
          id="hub-panel-queue"
          data-testid="hub-panel-queue"
          data-current={tab === 'queue' ? 'true' : 'false'}
          aria-hidden={tab === 'queue' ? undefined : 'true'}
          role="tabpanel"
          aria-labelledby="hub-tab-queue"
        >
          <Queue
            deliveries={props.deliveries}
            orders={props.orders}
            openOrder={props.openOrder}
            onToggle={props.onToggleOrder}
          />
        </div>
        <div
          className="mediator-panel"
          id="hub-panel-log"
          data-testid="hub-panel-log"
          data-current={tab === 'log' ? 'true' : 'false'}
          aria-hidden={tab === 'log' ? undefined : 'true'}
          role="tabpanel"
          aria-labelledby="hub-tab-log"
        >
          <Timeline entries={props.timeline} />
        </div>
      </div>
    </section>
  );
}
