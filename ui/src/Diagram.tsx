// ui/src/Diagram.tsx
// The machine: where an order comes from on the left, the mediator in the middle,
// the systems it delivers to on the right, and a line along every hop.
//
// This is the interface, not a picture of one. Breaking something used to mean
// scrolling past the whole page and opening a drawer called "Control panel", while
// the success criterion in specification section 1 is that a stranger breaks
// something on purpose within sixty seconds. So the tile you want to break carries
// the menu that breaks it, and the consequence lands on that same tile.
//
// Two corrections to the first version of that idea:
//
// The tile was a toggle, which flattened the four faults of specification section 7
// into on and off. The pair worth teaching is exactly the pair it lost: a system
// that answers 503 is down, and a system behind a dead line is running perfectly
// well. The menu names both.
//
// And the drawing had outgoing lines only, so every order appeared out of the middle
// of the picture. Specification section 4 has two ways in, and they are drawn.
//
// The hub is the biggest thing on the page on purpose. The specification calls the
// mediator the heart of the repo and defends building the queue by hand with "take
// a ready-made one and the most interesting part becomes invisible". Drawing it as
// a small box with a four-word caption made it invisible anyway. It now carries its
// own live state and opens into the full queue.
import { useState } from 'react';
import type { ChaosKind, DeliveryView, SwitchState, SwitchableTarget } from '@ngl/contracts';
import { activityFor } from './activity';
import { SOURCES, TARGETS, faultsFor, type Mischief } from './machine';
import { SystemMark, type MarkId } from './SystemMark';
import { TileMenu, type MenuItem } from './TileMenu';
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
}) {
  const pulses = useDeliveryPulses(props.deliveries);

  // Neither malformed order creates an event, so nothing about them turns up in the
  // queue or the log. What the endpoint answers is the only evidence the press did
  // anything, and it belongs on the tile that fired it.
  const [said, setSaid] = useState<Partial<Record<MarkId, string>>>({});

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

  const fire = (node: MarkId, kind: ChaosKind) => {
    void fetch(`/api/chaos/${kind}`, { method: 'POST' })
      .then((response) => response.json() as Promise<ChaosReply>)
      .then((reply) => setSaid((current) => ({ ...current, [node]: reply.detail })))
      .catch(() => setSaid((current) => ({ ...current, [node]: 'that did not go through' })));
  };

  const mischiefItems = (node: MarkId, mischief: Mischief[]): MenuItem[] =>
    mischief.map((one) => ({
      id: one.kind,
      label: one.label,
      run: () => fire(node, one.kind),
    }));

  const wire = (id: MarkId, state?: SwitchState, mark?: 'open' | 'done') => (
    <span
      className="line"
      data-testid={`line-${id}`}
      data-state={state}
      data-tracked={mark}
      aria-hidden="true"
    >
      {pulses
        .filter((pulse) => pulse.target === id)
        .map((pulse) => <span key={pulse.key} className={`dot dot-${pulse.kind}`} />)}
    </span>
  );

  const sources = (
    <ul className="spokes" data-side="left">
      {SOURCES.map((node) => (
        <li className="spoke" key={node.id}>
          <div className="target source" data-testid={`box-${node.id}`}>
            <SystemMark target={node.id} />
            <span className="name">{node.label}</span>
            <span className="note">{node.note}</span>
            {said[node.id] && (
              <span className="said" data-testid={`said-${node.id}`}>{said[node.id]}</span>
            )}
            {node.id === 'shop' && props.orderForm}
            {node.mischief.length > 0 && (
              <TileMenu
                testId={node.id}
                menuLabel={`Send something odd from the ${node.label.toLowerCase()}`}
                sections={[{ items: mischiefItems(node.id, node.mischief) }]}
              />
            )}
          </div>
          {wire(node.id)}
        </li>
      ))}
    </ul>
  );

  const targets = (
    <ul className="spokes" data-side="right">
      {TARGETS.map((node) => {
        const state = props.switches[node.target];
        const doing = activityFor(node.target, props.deliveries);
        const mark = tracked(node.target);
        const faults = faultsFor(node.target);
        const inForce = faults.find((fault) => fault.state === state);

        const sections = [
          {
            heading: 'How it behaves',
            items: faults.map((fault) => ({
              id: fault.state,
              label: fault.label,
              means: fault.means,
              chosen: fault.state === state,
              run: () => setFault(node.target, fault.state),
            })),
          },
          ...(node.mischief.length === 0
            ? []
            : [{ items: mischiefItems(node.target, node.mischief) }]),
        ];

        return (
          <li className="spoke" key={node.target}>
            {wire(node.target, state, mark)}
            <div
              className="target"
              data-testid={`box-${node.target}`}
              data-state={state}
              data-tracked={mark}
            >
              <SystemMark target={node.target} />
              <span className="name">{node.label}</span>
              <span className="note">{node.note}</span>
              {/* What this system is doing, always, not only when something is
                  stuck at it. A tile that says nothing while the machine works
                  looks like a tile of a machine that is not working. */}
              {doing && (
                <span
                  className="doing"
                  data-testid={`doing-${node.target}`}
                  data-tone={doing.tone}
                >
                  {doing.text}
                </span>
              )}
              {/* Silent while a system is simply working: five tiles announcing
                  "Reachable" is five lines of noise saying nothing happened. */}
              {state !== 'up' && inForce && (
                <span className="fault" data-testid={`state-${node.target}`}>
                  {inForce.label}
                </span>
              )}
              {said[node.target] && (
                <span className="said" data-testid={`said-${node.target}`}>
                  {said[node.target]}
                </span>
              )}
              <TileMenu
                testId={node.target}
                menuLabel={`Break ${node.label} on purpose`}
                sections={sections}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="hub" data-testid="diagram">
      {sources}
      {props.hub}
      {targets}
    </div>
  );
}
