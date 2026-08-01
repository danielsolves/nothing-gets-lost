// ui/src/machine.ts
// Every system in the drawing, and everything the page is allowed to say about it.
//
// The faults are the reason this file exists. The page used to flatten them into one
// on/off switch, which taught a visitor the wrong lesson: that an outage is a single
// thing. It is not: a call that goes through, one held up until it times out and one
// into a dead line are three different failures with three different recoveries, and
// the menu says which one is in force, in words, every time. See FAULTS for why the
// gate's fourth state is not among them.
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

/** One of the states a connection can be put into, and what that does. */
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

/**
 * What a visitor can do to a connection. Three, not the four the gate supports.
 *
 * The fourth was "Failing: the system is down and answers 503", and it was the one
 * thing on this page we could not do. Nothing here can make Slack fail. The gate
 * answers 503 in Slack's place, so the tile stated as fact something that was true
 * of our own container and false of the system it named. On a page whose argument is
 * that everything on it can be checked, that is the sentence a visitor would have
 * been right to disbelieve.
 *
 * What is left is what really happens: the call goes through, or it is held up until
 * it times out, or the line is dead. All three are done to the connection, which is
 * the thing we actually control, and all three are what an outage looks like from
 * the caller's side anyway.
 *
 * `error` stays in the contract and in the gate. Migration 001 has a CHECK constraint
 * naming it, migrations are never edited, and a state the gate can still be put into
 * by other means should not disappear from the vocabulary because one menu stopped
 * offering it.
 */
const FAULTS: Fault[] = [
  { state: 'up', label: 'Reachable', means: 'Calls go straight through' },
  { state: 'slow', label: 'Slow', means: 'Answers eight seconds late, so the call times out' },
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

/**
 * The systems a visitor can point at their own account, which is the only thing that
 * turns our read-back into their record.
 *
 * Two, and it is worth saying why the others are not. The ledger is our own service,
 * so there is no account to connect and no honest way out of "you have our word for
 * this"; that is the price of the Stripe receipt beside it being worth something.
 * The mailer already lands in the visitor's own inbox, which is stronger than any
 * connecting would make it. Stripe is a receipt on stripe.com and needs nothing.
 */
const CONNECTABLE: readonly SwitchableTarget[] = ['hubspot', 'slack'];

/** Takes any target, because the caller has one of the six, not one of the five. */
export function canConnectOwn(target: string): boolean {
  return (CONNECTABLE as readonly string[]).includes(target);
}
