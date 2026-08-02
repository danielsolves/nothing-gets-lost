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
//
// A badge in the corner of the head used to say whether the event stream was up. It
// is gone: for the whole of every visit it read "Live" in green, which is one more
// claim the reader has to take our word for, next to numbers that already move by
// themselves when the stream is alive.
import { useState } from 'react';
import type { Counters, DeliveryView, OrderView, TimelineEntry } from '@ngl/contracts';
import { currentWork } from './activity';
import { Backlog } from './Backlog';
import { backlogOf } from './backlog-rows';
import { Queue } from './Queue';
import { TabPanels, TabStrip, type TabSpec } from './Tabs';
import { Timeline } from './Timeline';
import { othersHere } from './viewers';

type Tab = 'queue' | 'log' | 'backlog';

export function Mediator(props: {
  counters: Counters;
  deliveries: DeliveryView[];
  orders: OrderView[];
  timeline: TimelineEntry[];
  openOrder: string | null;
  onToggleOrder: (eventId: string) => void;
  /** Everyone on the page, this reader included. */
  viewers: number;
}) {
  const [tab, setTab] = useState<Tab>('queue');
  const [help, setHelp] = useState(false);
  const doing = currentWork(props.deliveries);
  const others = othersHere(props.viewers);
  // Counted here rather than inside the panel: the tab has to say how many are
  // waiting while the panel is shut, which is the state it is in nearly always.
  const parked = backlogOf(props.deliveries, props.orders).length;

  const tabs: TabSpec<Tab>[] = [
    {
      key: 'queue',
      label: 'Order queue',
      panel: (
        <Queue
          deliveries={props.deliveries}
          orders={props.orders}
          openOrder={props.openOrder}
          onToggle={props.onToggleOrder}
        />
      ),
    },
    { key: 'log', label: 'Log', panel: <Timeline entries={props.timeline} /> },
    // The third thing the mediator holds. It carries its count on the tab because a
    // backlog behind a shut panel is a backlog nobody knows about, and this panel is
    // shut nearly all the time: the demo delivers.
    {
      key: 'backlog',
      label: 'Backlog',
      badge: parked > 0
        ? (
          <span className="hub-tab-count" data-testid="hub-tab-backlog-count">
            {parked}
          </span>
        )
        : undefined,
      panel: <Backlog deliveries={props.deliveries} orders={props.orders} />,
    },
  ];

  return (
    <section className="mediator" data-testid="mediator">
      <header className="mediator-head">
        {/* "The mediator" is what this thing is called in the specification and in
            every file name under services/, and it stayed on screen for a long time
            for that reason. It is a word from the architecture, not from the
            visitor's world: somebody arriving from a case list has to be told what a
            mediator is before the panel means anything, which is what the question
            mark beside it was for. "Integration hub" needs no such introduction.
            The name inside the code has not changed, and should not: it is what the
            pattern is called. */}
        <span className="mediator-titles">
          <span className="mediator-title">Integration hub</span>
          <span className="mediator-sub">tracks, retries, and recovers</span>
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
            aria-label="What does the integration hub do?"
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
                <li>Writes what it cannot deliver to a backlog, rather than dropping it</li>
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

      {/* What it is doing, and who else is watching it happen. The second one is
          here because this is the line it qualifies: a reader who has touched
          nothing and sees work going on reads it as a script unless somebody says
          there is another person on the page. */}
      <p className="mediator-doing" data-testid="hub-doing" data-tone={doing.tone}>
        <span>{doing.text}</span>
        {others && (
          <em className="mediator-doing-others" data-testid="hub-viewers">
            {others}
          </em>
        )}
      </p>

      <TabStrip
        tabs={tabs}
        current={tab}
        onPick={setTab}
        label="What the hub holds"
        tabPrefix="hub-tab"
        panelPrefix="hub-panel"
      />

      {/* A window of a size that does not move, which is why this one takes its
          height from the stylesheet rather than from the panel on screen. An opened
          card makes itself taller and pushes the cards below it down; the window
          stays as it was and the list scrolls inside it. */}
      <TabPanels
        tabs={tabs}
        current={tab}
        fit="window"
        tabPrefix="hub-tab"
        panelPrefix="hub-panel"
      />
    </section>
  );
}
