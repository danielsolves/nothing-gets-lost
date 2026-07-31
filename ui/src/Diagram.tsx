// ui/src/Diagram.tsx
// The machine: two columns of nodes, the mediator between them, and a line from
// every node to the bus that runs down the hub's edge.
//
// This is the interface, not a picture of one. Breaking something used to mean
// scrolling past the whole page and opening a drawer called "Control panel", while
// the success criterion in specification section 1 is that a stranger breaks
// something on purpose within sixty seconds. So the tile you want to break carries
// the menu that breaks it, and the consequence lands on that same tile.
//
// Three corrections to earlier versions of that idea, all worth keeping written down:
//
// The tile was a toggle, which flattened the four faults of specification section 7
// into on and off. The pair worth teaching is exactly the pair it lost: a system
// that answers 503 is down, and a system behind a dead line is running perfectly
// well. The menu names both.
//
// The drawing had outgoing lines only, so every order appeared out of the middle of
// the picture. Specification section 4 has two ways in, and they are drawn.
//
// And the columns were sources on the left against every system on the right, two
// against five. That left the hub shorter than the column beside it, so the top and
// bottom lines began in mid-air next to the hub rather than at it. Four against
// three balances, and a bus down each inner edge means every line ends somewhere
// whatever the two heights turn out to be.
import { useState } from 'react';
import type { ChaosKind, DeliveryView, SwitchState, SwitchableTarget } from '@ngl/contracts';
import { activityFor } from './activity';
import { FOOT, LEFT, RIGHT, faultsFor, type Mischief, type Node, type NodeId } from './machine';
import { NodeTile } from './NodeTile';
import { type MenuItem, type MenuSection } from './TileMenu';
import { useDeliveryPulses } from './useDeliveryPulses';

interface ChaosReply { detail?: string }

export function Diagram(props: {
  switches: Record<SwitchableTarget, SwitchState>;
  deliveries: DeliveryView[];
  /** The order opened in the queue, if any. Its path is marked here. */
  openOrder?: string | null;
  /** The hub itself, passed in so this file stays layout and wiring. */
  hub: React.ReactNode;
  /**
   * The order form, which lives on the shop tile. An order that starts at the top
   * of the page and appears in the middle of the drawing skips the one hop the
   * drawing exists to show, so the button that sends it sits at the place it is
   * sent from.
   */
  orderForm?: React.ReactNode;
  /**
   * Specification 8.5 wants the one replayed step said out loud. It used to be a
   * banner under the whole machine, which is the part of a page nobody reads. It
   * belongs on the tile it is about.
   */
  extractorMode?: 'live' | 'recorded';
}) {
  const pulses = useDeliveryPulses(props.deliveries);

  // Neither malformed order creates an event, so nothing about them turns up in the
  // queue or the log. What the endpoint answers is the only evidence the press did
  // anything, and it belongs on the tile that fired it.
  const [said, setSaid] = useState<Partial<Record<NodeId, string>>>({});

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

  const fire = (node: NodeId, kind: ChaosKind) => {
    void fetch(`/api/chaos/${kind}`, { method: 'POST' })
      .then((response) => response.json() as Promise<ChaosReply>)
      .then((reply) => setSaid((current) => ({ ...current, [node]: reply.detail })))
      .catch(() => setSaid((current) => ({ ...current, [node]: 'that did not go through' })));
  };

  const mischiefItems = (node: NodeId, mischief: Mischief[]): MenuItem[] =>
    mischief.map((one) => ({
      id: one.kind,
      label: one.label,
      run: () => fire(node, one.kind),
    }));

  const menuFor = (node: Node): MenuSection[] => {
    const mischief = node.mischief.length === 0
      ? []
      : [{ items: mischiefItems(node.id, node.mischief) }];
    if (node.kind === 'source') return mischief;

    const state = props.switches[node.id];
    return [
      {
        heading: 'How it behaves',
        items: faultsFor(node.id).map((fault) => ({
          id: fault.state,
          label: fault.label,
          means: fault.means,
          chosen: fault.state === state,
          run: () => setFault(node.id, fault.state),
        })),
      },
      ...mischief,
    ];
  };

  const menuLabelFor = (node: Node) =>
    node.kind === 'source'
      ? `Send something odd from the ${node.label.toLowerCase()}`
      : `Break ${node.label} on purpose`;

  /**
   * A source sends its dot towards the hub and a system receives one from it, so
   * the direction belongs to the node rather than to the column: both kinds now
   * share the left side.
   */
  const wire = (node: Node) => {
    const system = node.kind === 'system';
    return (
      <span
        className="line"
        data-testid={`line-${node.id}`}
        data-state={system ? props.switches[node.id] : undefined}
        data-tracked={system ? tracked(node.id) : undefined}
        data-flow={system ? 'out' : 'in'}
        aria-hidden="true"
      >
        {pulses
          .filter((pulse) => pulse.target === node.id)
          .map((pulse) => <span key={pulse.key} className={`dot dot-${pulse.kind}`} />)}
      </span>
    );
  };

  /**
   * The shop is the entry point and the only node that looks different, because it
   * is the only one that asks the visitor for something. The recorded-model note
   * rides on the mail for the same reason: specification 8.5 wants it said, and the
   * tile it is about is where it will actually be read.
   */
  const extraFor = (node: Node) => {
    if (node.id === 'shop') return props.orderForm;
    if (node.id === 'mail' && props.extractorMode === 'recorded') {
      return (
        <span className="said" data-testid="extractor-mode">
          Replayed. No model key here.
        </span>
      );
    }
    return undefined;
  };

  const tile = (node: Node) => {
    const system = node.kind === 'system';
    const state = system ? props.switches[node.id] : undefined;
    return (
      <NodeTile
        node={node}
        state={state}
        inForce={system ? faultsFor(node.id).find((f) => f.state === state) : undefined}
        doing={system ? activityFor(node.id, props.deliveries) : null}
        tracked={system ? tracked(node.id) : undefined}
        said={said[node.id]}
        menu={menuFor(node)}
        menuLabel={menuLabelFor(node)}
        extra={extraFor(node)}
      />
    );
  };

  /** The wire always sits between the tile and the hub, so it swaps sides. */
  const column = (nodes: Node[], side: 'left' | 'right' | 'foot') => (
    <ul className="spokes" data-side={side} data-testid={`spokes-${side}`}>
      {nodes.map((node) => (
        <li className="spoke" key={node.id}>
          {side === 'left' ? tile(node) : wire(node)}
          {side === 'left' ? wire(node) : tile(node)}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="hub" data-testid="diagram">
      {column(LEFT, 'left')}
      {props.hub}
      {column(RIGHT, 'right')}
      {column(FOOT, 'foot')}
    </div>
  );
}
