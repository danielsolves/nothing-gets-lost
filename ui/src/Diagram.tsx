// ui/src/Diagram.tsx
// The machine: a heading and the one way in at the top, the mediator on the left,
// and the systems it delivers to filling the space beside and below it.
//
// This is the interface, not a picture of one. Breaking something used to mean
// scrolling past the whole page and opening a drawer called "Control panel", while
// the success criterion in specification section 1 is that a stranger breaks
// something on purpose within sixty seconds. So the tile you want to break carries
// the menu that breaks it, and the consequence lands on that same tile.
//
// Corrections to earlier versions of that idea, all worth keeping written down:
//
// The tile was a toggle, which flattened the four faults of specification section 7
// into on and off. The pair worth teaching is exactly the pair it lost: a system
// that answers 503 is down, and a system behind a dead line is running perfectly
// well. The menu names both.
//
// The drawing had outgoing lines only, so every order appeared out of the middle of
// the picture. There is a way in now and it is a button, at the top, where a visitor
// starts reading. It is one button rather than two tiles: the shop and the order
// mail were drawn as nodes beside the systems, which made two places an order comes
// from look like two more places it goes to.
//
// And the nodes stood in three fixed columns, which is why the lines could be strips
// of CSS. Letting the systems wrap means a line has to turn a corner, so the lines
// are measured and drawn as one SVG over the box. That is also what the travelling
// dots now run along, so the drawing and the motion cannot disagree about where a
// delivery goes.
import { useState } from 'react';
import type { ChaosKind, DeliveryView, SwitchState, SwitchableTarget } from '@ngl/contracts';
import { activityFor, lastDeliveredEvent } from './activity';
import { NODES, ORDER_WAYS, faultsFor, type Node, type NodeId } from './machine';
import { NodeTile } from './NodeTile';
import { StepProof } from './StepProof';
import { TileMenu, type MenuSection } from './TileMenu';
import { useDeliveryPulses } from './useDeliveryPulses';
import { useWires } from './useWires';

interface ChaosReply { detail?: string }

const TARGETS: readonly string[] = NODES.map((node) => node.id);

export function Diagram(props: {
  switches: Record<SwitchableTarget, SwitchState>;
  deliveries: DeliveryView[];
  /** The order opened in the queue, if any. Its path is marked here. */
  openOrder?: string | null;
  /** The hub itself, passed in so this file stays layout and wiring. */
  hub: React.ReactNode;
  /**
   * What the machine could not deliver, drawn under the systems it failed to reach.
   *
   * It goes in the column beside the mediator rather than under the whole machine
   * because that column ended halfway down: the hub is about twice the height of the
   * five tiles, and the space under them was empty. This is the one panel that
   * belongs there — everything in it is a system that would not answer.
   */
  backlog?: React.ReactNode;
  /**
   * The one way in. It sits at the top of the machine rather than on a tile of its
   * own, because there is one entrance and a visitor should meet it before the
   * seven things it feeds.
   */
  orderForm?: React.ReactNode;
  /**
   * Specification 8.5 wants the one replayed step said out loud. It was a banner
   * under the whole machine, then a note on the order-mail tile, then a line beside
   * the send button. Each move was towards the place it is true, and beside the
   * button it was still not: it sat next to the ordinary order, which never touches
   * the model, and read as a caveat about the whole machine.
   *
   * It is on the two menu entries that are read by the model, and nowhere else.
   */
  extractorMode?: 'live' | 'recorded';
  /**
   * Sends a visitor to the section where they connect their own account. The tiles
   * offer that as the way out of "you only have our word for this", so the drawing
   * has to be able to open it.
   */
  onConnectOwn?: () => void;
}) {
  const pulses = useDeliveryPulses(props.deliveries);
  const layer = useWires(TARGETS);

  // Neither malformed order creates an event, so nothing about them turns up in the
  // queue or the log. What the endpoint answers is the only evidence the press did
  // anything, and it belongs beside the button that fired it.
  const [said, setSaid] = useState<Partial<Record<NodeId | 'entry', string>>>({});

  // Opening a card in the queue lights up that order's path here, so the queue and
  // the systems read as one thing seen twice rather than as neighbours.
  const tracked = (target: SwitchableTarget): 'open' | 'done' | undefined => {
    if (!props.openOrder) return undefined;
    const step = props.deliveries.find(
      (delivery) => delivery.eventId === props.openOrder && delivery.target === target,
    );
    if (!step) return undefined;
    return step.state === 'done' ? 'done' : 'open';
  };

  const setFault = (target: SwitchableTarget, state: SwitchState) => {
    void fetch(`/api/switches/${target}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state }),
    });
  };

  const fire = (node: NodeId | 'entry', kind: ChaosKind) => {
    void fetch(`/api/chaos/${kind}`, { method: 'POST' })
      .then((response) => response.json() as Promise<ChaosReply>)
      .then((reply) => setSaid((current) => ({ ...current, [node]: reply.detail })))
      .catch(() => setSaid((current) => ({ ...current, [node]: 'that did not go through' })));
  };

  const menuFor = (node: Node): MenuSection[] => {
    const mischief = node.mischief.length === 0
      ? []
      : [{
        items: node.mischief.map((one) => ({
          id: one.kind,
          label: one.label,
          run: () => fire(node.id, one.kind),
        })),
      }];

    return [
      {
        heading: 'How it behaves',
        items: faultsFor(node.id).map((fault) => ({
          id: fault.state,
          label: fault.label,
          means: fault.means,
          chosen: fault.state === props.switches[node.id],
          run: () => setFault(node.id, fault.state),
        })),
      },
      ...mischief,
    ];
  };

  /**
   * The two odd orders. The clean one is the button itself, so it is listed here
   * without an action of its own: naming it is what tells a visitor that the plain
   * press is the first of three things, rather than leaving them to guess that the
   * menu holds the whole set.
   */
  const waysSection: MenuSection = {
    heading: 'What to send',
    items: ORDER_WAYS.filter((way) => way.kind !== null).map((way) => ({
      id: way.id,
      label: way.label,
      means: props.extractorMode === 'recorded'
        ? `${way.means}. Replayed here: no model key is configured`
        : way.means,
      run: () => fire('entry', way.kind as ChaosKind),
    })),
  };

  /**
   * The check sits on the tile because that is what somebody points at when they ask
   * whether a system is real. It was only in the queue card for a while, two clicks
   * deep, where the question is never asked.
   *
   * Nothing to offer until that system has delivered something: a check against a
   * call that was never made answers 404 about nothing.
   */
  const proofFor = (node: Node) => {
    const eventId = lastDeliveredEvent(node.id, props.deliveries);
    if (eventId === null) return undefined;
    return (
      <StepProof
        eventId={eventId}
        target={node.id}
        label={node.label}
        layout="tile"
        onConnectOwn={props.onConnectOwn}
      />
    );
  };

  const tile = (node: Node) => (
    <NodeTile
      node={node}
      state={props.switches[node.id]}
      inForce={faultsFor(node.id).find((f) => f.state === props.switches[node.id])}
      doing={activityFor(node.id, props.deliveries)}
      tracked={tracked(node.id)}
      said={said[node.id]}
      menu={menuFor(node)}
      menuLabel={`Break ${node.label} on purpose`}
      extra={proofFor(node)}
    />
  );

  return (
    <div className="machine" data-testid="diagram">
      <header className="machine-head" data-testid="machine-head">
        {/* An invitation rather than a label. "One order, five real systems" named
            what is below, which the drawing already does; this says what the
            visitor is meant to do about it, and it is the answer to the heading at
            the top of the page: that one asks to be trusted, this one does not. */}
        <h2 className="machine-title">See it work for yourself.</h2>
        {/* The whole sixty seconds in three sentences: send one, break something,
            send another. Specification section 1 wants a stranger to break something
            on purpose inside a minute, and this is the only place on the page that
            tells them they are allowed to. */}
        <p className="machine-lede">
          Create a test order and watch it move through every system. Then use any
          system’s menu to take its connection offline and send another order. Watch
          the workflow hold it safely, retry automatically, and continue when the
          connection returns.
        </p>

        <div className="machine-entry">
          {/* Measured, so the line into the mediator hangs under this rather than
              under the middle of the panel. */}
          <span className="machine-entry-button" ref={layer.entryRef}>
            {props.orderForm}
          </span>
          <TileMenu
            menuLabel="Send an order that is not well formed"
            testId="entry"
            sections={[waysSection]}
          />
          {said.entry !== undefined && (
            <span className="said" data-testid="said-entry">{said.entry}</span>
          )}
        </div>
      </header>

      <div className="machine-body" ref={layer.frameRef}>
        {/* One drawing for every line, sized to the box it covers. Behind the tiles
            in paint order and transparent to the pointer, so a line can never eat a
            click meant for the system it points at. */}
        <svg
          className="wires"
          aria-hidden="true"
          width={layer.size.width}
          height={layer.size.height}
          viewBox={`0 0 ${layer.size.width} ${layer.size.height}`}
        >
          {layer.wires.map((wire) => (
            <path
              key={wire.target}
              d={wire.d}
              className="wire"
              data-testid={`line-${wire.target}`}
              data-flow={wire.target === 'shop' ? 'in' : 'out'}
              data-state={props.switches[wire.target as SwitchableTarget]}
              data-tracked={tracked(wire.target as SwitchableTarget)}
            />
          ))}
        </svg>

        {/* The packets are ordinary elements rather than SVG ones, handed the same
            path as a motion path. SMIL inside a node React has just inserted starts
            counting from the document timeline and so plays its first frames in the
            past; an element with offset-path starts when it is painted, which is the
            moment the delivery actually changed. */}
        <div className="packets" aria-hidden="true">
          {layer.wires.map((wire) => pulses
            .filter((pulse) => pulse.target === wire.target)
            .map((pulse) => (
              <span
                key={pulse.key}
                className={`packet packet-${pulse.kind}`}
                data-testid={`packet-${wire.target}`}
                style={{ offsetPath: `path("${wire.d}")` }}
              />
            )))}
        </div>

        <div className="machine-hub" ref={layer.hubRef}>{props.hub}</div>

        {/* One column, so the backlog sits under the tiles rather than under the
            mediator. The tiles keep their own grid inside it and are still measured
            individually, so the lines are drawn from where each one ended up. */}
        <div className="machine-side">
          <ul className="systems">
            {NODES.map((node) => (
              <li className="system" key={node.id} ref={layer.tileRef(node.id)}>
                {tile(node)}
              </li>
            ))}
          </ul>
          {props.backlog}
        </div>
      </div>
    </div>
  );
}
