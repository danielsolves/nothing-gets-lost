// ui/src/machine.ts
// Every node in the drawing, which side it stands on, and everything the page is
// allowed to say about it.
//
// The four faults are the reason this file exists. The page used to flatten them
// into one on/off switch, which taught a visitor the wrong lesson: that an outage is
// a single thing. Specification section 7 has four, and the two that look alike are
// the pair worth teaching. A system that answers 503 is down. A system behind a dead
// line is running perfectly well and we simply cannot reach it, which the README
// calls the most common real-world outage. So the menu says which of the two it is,
// in words, every time.
//
// The columns are not sources on one side and systems on the other. That split was
// tidy and it made the drawing lopsided: five tiles on the right against two on the
// left, so the hub was shorter than the column beside it and the outermost lines
// began in mid-air next to it rather than at it. The side a node stands on is now a
// layout fact rather than a claim about its nature. What it is stays in `kind`.
//
// Three sides, not two: what comes in on the left, what the order is written into on
// the right, and the money underneath. The payment earns its own place because it is
// the one hop every order makes before any of the others is worth doing, and because
// there is more than one way to make it.
//
// Kept out of the components because copy is the part most likely to drift back into
// vagueness, and here it can be checked without rendering anything.
import type { ChaosKind, SwitchState, SwitchableTarget } from '@ngl/contracts';

/** One of the four states the egress gate can be put into, and what it does. */
export interface Fault {
  state: SwitchState;
  label: string;
  means: string;
}

/** A one-off action: POST /api/chaos/<kind>. */
export interface Mischief {
  kind: ChaosKind;
  label: string;
}

export type SourceId = 'shop' | 'mail';
export type NodeId = SwitchableTarget | SourceId;
/**
 * Where a node is drawn. The money sits under the hub rather than in a column,
 * because a payment is the one hop every order makes before anything else is worth
 * doing, and because there is about to be more than one way to make it.
 */
export type Side = 'left' | 'right' | 'foot';

interface Common {
  label: string;
  note: string;
  side: Side;
  mischief: Mischief[];
}

/** Somewhere the mediator delivers to. It can be broken, so it has faults. */
export interface SystemNode extends Common {
  kind: 'system';
  id: SwitchableTarget;
}

/**
 * Where an order comes from. Not something we call, so it has no state and cannot
 * be broken. It is drawn because the picture used to have outgoing lines only, and
 * orders appeared out of the middle of it.
 */
export interface SourceNode extends Common {
  kind: 'source';
  id: SourceId;
}

export type Node = SystemNode | SourceNode;

const FAULTS: Fault[] = [
  { state: 'up', label: 'Reachable', means: 'Calls go straight through' },
  { state: 'slow', label: 'Slow', means: 'Answers eight seconds late, so the call times out' },
  { state: 'error', label: 'Failing', means: 'The system is down and answers 503' },
  { state: 'cut', label: 'Unreachable', means: 'The line is dead. The system itself is fine' },
];

/**
 * The ledger is the one target where off means off: it closes its listening socket
 * rather than being cut at the gate (spec 7). Saying the same sentence about it as
 * about the others would be false about one of them.
 */
const LEDGER_CUT: Fault = {
  state: 'cut',
  label: 'Unreachable',
  means: 'The service really stops listening. This one is off, not just unreachable',
};

export function faultsFor(target: SwitchableTarget): Fault[] {
  if (target !== 'ledger') return FAULTS;
  return FAULTS.map((fault) => (fault.state === 'cut' ? LEDGER_CUT : fault));
}

/**
 * Reading order, top to bottom, left column then right.
 *
 * The shop leads because it is where a visitor starts: it carries the button that
 * sends an order. The two ways in stand together above the two systems that share
 * the column, so the grouping survives the rebalancing.
 *
 * The duplicate payment lives on Stripe because that is where a repeated webhook
 * comes from in the first place, and the two malformed orders live on the mail they
 * would arrive as. Read on a tile each one is a question about that node.
 *
 * The two payment routes stand side by side under the hub, and exactly one of them
 * is charged for any given order. The other tile stays quiet rather than going
 * green, which is the whole reason they are drawn as a pair.
 */
export const NODES: Node[] = [
  {
    kind: 'source', id: 'shop', side: 'left',
    label: 'Shop page', note: 'structured order', mischief: [],
  },
  {
    kind: 'source', id: 'mail', side: 'left',
    label: 'Order mail', note: 'free text, read by AI',
    mischief: [
      { kind: 'garbage_payload', label: 'Send a half-written order' },
      { kind: 'hallucinate', label: 'Make the AI invent an article number' },
    ],
  },
  {
    kind: 'system', id: 'mailer', side: 'left',
    label: 'Confirmation mail', note: 'last in the chain', mischief: [],
  },
  {
    kind: 'system', id: 'hubspot', side: 'right',
    label: 'HubSpot', note: 'CRM', mischief: [],
  },
  {
    kind: 'system', id: 'ledger', side: 'right',
    label: 'Invoices', note: 'our own service', mischief: [],
  },
  {
    kind: 'system', id: 'slack', side: 'right',
    label: 'Slack', note: 'notification', mischief: [],
  },
  {
    kind: 'system', id: 'stripe', side: 'foot',
    label: 'Stripe', note: 'payment',
    mischief: [{ kind: 'duplicate_webhook', label: 'Deliver the payment twice' }],
  },
];

export const LEFT: Node[] = NODES.filter((node) => node.side === 'left');
export const RIGHT: Node[] = NODES.filter((node) => node.side === 'right');
export const FOOT: Node[] = NODES.filter((node) => node.side === 'foot');
export const SOURCES: SourceNode[] = NODES.filter(
  (node): node is SourceNode => node.kind === 'source',
);
export const SYSTEMS: SystemNode[] = NODES.filter(
  (node): node is SystemNode => node.kind === 'system',
);
