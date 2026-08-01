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
import { activityFor } from './activity';
import { NODES, ORDER_WAYS, faultsFor, type Node, type NodeId } from './machine';
import { NodeTile } from './NodeTile';
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
   * The one way in. It sits at the top of the machine rather than on a tile of its
   * own, because there is one entrance and a visitor should meet it before the
   * seven things it feeds.
   */
  orderForm?: React.ReactNode;
  /**
   * Specification 8.5 wants the one replayed step said out loud. It used to be a
   * banner under the whole machine, which is the part of a page nobody reads, and
   * then a note on the order-mail tile. That tile is gone, so it says its piece
   * beside the button whose odd orders are the thing the model reads.
   */
  extractorMode?: 'live' | 'recorded';
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
      means: way.means,
      run: () => fire('entry', way.kind as ChaosKind),
    })),
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
    />
  );

  return (
    <div className="machine" data-testid="diagram">
      <header className="machine-head" data-testid="machine-head">
        <h2 className="machine-title">One order, five real systems</h2>
        <p className="machine-lede">
          Press the button. The mediator takes the order, calls each system in turn and
          writes down what came back. Open any system to break it, then press again and
          watch where the order waits instead of disappearing.
        </p>

        <div className="machine-entry">
          {props.orderForm}
          <TileMenu
            menuLabel="Send an order that is not well formed"
            testId="entry"
            sections={[waysSection]}
          />
          {props.extractorMode === 'recorded' && (
            <span className="said" data-testid="extractor-mode">
              The model step is replayed. No model key here.
            </span>
          )}
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

        <ul className="systems">
          {NODES.map((node) => (
            <li className="system" key={node.id} ref={layer.tileRef(node.id)}>
              {tile(node)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
