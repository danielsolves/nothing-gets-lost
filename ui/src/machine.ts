// ui/src/machine.ts
// Every system in the drawing, and everything the page is allowed to say about it.
//
// The four faults are the reason this file exists. The page used to flatten them
// into one on/off switch, which taught a visitor the wrong lesson: that an outage is
// a single thing. Specification section 7 has four, and the two that look alike are
// the pair worth teaching. A system that answers 503 is down. A system behind a dead
// line is running perfectly well and we simply cannot reach it, which the README
// calls the most common real-world outage. So the menu says which of the two it is,
// in words, every time.
//
// There are no source nodes left. The shop and the order mail used to be drawn as
// tiles beside the systems, which put three different kinds of thing in one row: two
// places an order comes from and five places it goes to, all shaped alike. There is
// one way in now and it is a button, at the top of the machine where a visitor
// starts. What used to be the mail tile survives as the second and third way to
// press that button, because a half-written order is not another system, it is
// another thing to send.
//
// So the sides are gone too. A node no longer says where it stands: the mediator is
// on the left and the systems fill the space beside and below it, which is a fact
// about the layout and belongs to the stylesheet.
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

export type NodeId = SwitchableTarget;

/** Somewhere the mediator delivers to. It can be broken, so it has faults. */
export interface SystemNode {
  kind: 'system';
  id: SwitchableTarget;
  label: string;
  note: string;
  mischief: Mischief[];
}

export type Node = SystemNode;

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
 * One way in, three things to send through it.
 *
 * The clean order is the plain press. The other two are what the order mail tile
 * used to carry: specification section 4 has a free-text route read by the model,
 * and the whole point of drawing it was that malformed input does not get lost
 * either. Neither creates an event, so nothing about them turns up in the queue, and
 * the reply from the endpoint is the only evidence the press did anything.
 *
 * `kind: null` is the ordinary order. It is in the same list rather than beside it
 * because to a visitor these are three variants of one action, and a list that holds
 * only the odd two would read as if the normal case lived somewhere else.
 */
export interface OrderWay {
  id: string;
  label: string;
  means: string;
  kind: ChaosKind | null;
}

export const ORDER_WAYS: OrderWay[] = [
  {
    id: 'clean',
    label: 'Send a clean order',
    means: 'A well-formed basket, straight from the shop page',
    kind: null,
  },
  {
    id: 'garbage_payload',
    label: 'Send a half-written order',
    means: 'Free text the model has to make sense of, and cannot',
    kind: 'garbage_payload',
  },
  {
    id: 'hallucinate',
    label: 'Make the AI invent an article number',
    means: 'The model returns a SKU that does not exist. It is caught, not stored',
    kind: 'hallucinate',
  },
];

/**
 * Reading order. The payment leads because it is the one hop every order makes
 * before any of the others is worth doing. The confirmation mail is last because it
 * is last in the chain, and the three in between are what the order is written into.
 */
export const NODES: Node[] = [
  {
    kind: 'system', id: 'stripe',
    label: 'Stripe', note: 'payment',
    mischief: [{ kind: 'duplicate_webhook', label: 'Deliver the payment twice' }],
  },
  {
    kind: 'system', id: 'hubspot',
    label: 'HubSpot', note: 'CRM', mischief: [],
  },
  {
    kind: 'system', id: 'ledger',
    label: 'Invoices', note: 'our own service', mischief: [],
  },
  {
    kind: 'system', id: 'slack',
    label: 'Slack', note: 'notification', mischief: [],
  },
  {
    kind: 'system', id: 'mailer',
    label: 'Confirmation mail', note: 'last in the chain', mischief: [],
  },
];

export const SYSTEMS: SystemNode[] = NODES;
