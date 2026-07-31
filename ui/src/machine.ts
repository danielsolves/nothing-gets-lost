// ui/src/machine.ts
// Everything the diagram is allowed to say about a system, as data.
//
// The page used to flatten four real faults into one on/off switch, which taught a
// visitor the wrong lesson: that an outage is a single thing. Specification section
// 7 has four, and the two that look alike are the pair worth teaching. A system that
// answers 503 is down. A system behind a dead line is running perfectly well and we
// simply cannot reach it, which the README calls the most common real-world outage.
// So the menu says which of the two it is, in words, every time.
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

export interface TargetNode {
  target: SwitchableTarget;
  label: string;
  note: string;
  mischief: Mischief[];
}

/** Where an order comes from. Not something we call, so it has no state. */
export interface SourceNode {
  id: 'shop' | 'mail';
  label: string;
  note: string;
  mischief: Mischief[];
}

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
 * The duplicate lives on Stripe because that is where a repeated webhook comes
 * from in the first place. Read on a tile it is a question about that system:
 * what happens if Stripe tells us twice?
 */
export const TARGETS: TargetNode[] = [
  {
    target: 'stripe',
    label: 'Stripe',
    note: 'payment',
    mischief: [{ kind: 'duplicate_webhook', label: 'Deliver the payment twice' }],
  },
  { target: 'hubspot', label: 'HubSpot', note: 'CRM', mischief: [] },
  { target: 'ledger', label: 'Invoices', note: 'our own service', mischief: [] },
  { target: 'slack', label: 'Slack', note: 'notification', mischief: [] },
  { target: 'mailer', label: 'Confirmation mail', note: 'last in the chain', mischief: [] },
];

/**
 * Specification section 4 has two ways in. The diagram drew neither, so orders
 * appeared out of the middle of the picture, and the two mischief buttons that act
 * on the incoming mail sat in a drawer at the bottom of the page under a heading
 * that said nothing about where they landed.
 */
export const SOURCES: SourceNode[] = [
  { id: 'shop', label: 'Shop page', note: 'structured order', mischief: [] },
  {
    id: 'mail',
    label: 'Order mail',
    note: 'free text, read by AI',
    mischief: [
      { kind: 'garbage_payload', label: 'Send a half-written order' },
      { kind: 'hallucinate', label: 'Make the AI invent an article number' },
    ],
  },
];
