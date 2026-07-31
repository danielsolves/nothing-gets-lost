# How it works

This page follows one order from the moment it arrives to the moment the confirmation mail goes out, and it is written for a developer who wants to see whether the guarantees are real or decorative.

## The path of one order

1. An order reaches `services/api/src/orders.service.ts` through one of two doors. `POST /api/demo-order` carries nothing at all: it is the button in the opening, and it uses the `DEFAULT_BASKET` from `@ngl/contracts`. `POST /api/orders` carries the basket a visitor chose, and their name and email address if they typed them. Either way the total is computed from the `products` table, never from the request body: a visitor who posts a zero cent order would otherwise produce a Stripe receipt that proves nothing. An address that is there is validated, a blank one is not a mistake to be told about, and the payload keeps the two cases apart in two fields rather than one. `customerEmail` is the identity the order is booked under, always set, falling back to a house address, because Stripe wants one for the receipt and HubSpot uses it as the natural key below. `confirmTo` is the promise of a mail, and rule 6.7 is the only rule that reads it.
2. The api does not write the queue. It hands the event to the mediator over `POST /internal/enqueue` (`services/api/src/mediator.intake.ts`), so the exactly once rules live in exactly one process. `EnqueueController` rejects anything that is not `{ externalId, kind, payload, targets[] }` with a known kind and known targets: a bad target would sit in the queue forever with no worker registered for it.
3. `IntakeService` inserts the event and one delivery row per target. An order asks for four: `stripe`, `hubspot`, `ledger`, `slack`. The confirmation mail is missing on purpose (see rule 6.7 below).
4. The worker loop claims due rows, calls the matching target through the egress gate, and records the outcome.
5. After every successful non mailer delivery the worker asks whether the rest of the chain is finished. When it is, and when the event carries a `confirmTo`, the `mailer` delivery is created, claimed on the next tick, and the mail goes out.

## The two tables

`packages/db/migrations/001_initial.sql`:

```sql
CREATE TABLE deliveries (
  id          bigserial PRIMARY KEY,
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  target      text NOT NULL CHECK (target IN
                ('hubspot','stripe','slack','ledger','mailer','custom_webhook')),
  state       text NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending','inflight','done','dead')),
  attempts    int  NOT NULL DEFAULT 0,
  next_at     timestamptz NOT NULL DEFAULT now(),
  last_error  text,
  remote_ref  text,
  remote_at   timestamptz,
  locked_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, target)
);
```

`events.external_id` is unique, and `deliveries` has `UNIQUE (event_id, target)`. Those two constraints are the whole deduplication story, and they are worth being precise about because they buy different things.

`UNIQUE (external_id)` means the same Stripe webhook, replayed, cannot become a second event:

```sql
INSERT INTO events (external_id, kind, payload)
VALUES ($1, $2, $3::jsonb)
ON CONFLICT (external_id) DO NOTHING
RETURNING id
```

On conflict the insert returns nothing, so `IntakeService` reads the existing id back and reports `accepted: false`. Two copies of the same webhook arriving at the same instant therefore end up on the same event id, and only one of them reports acceptance.

`UNIQUE (event_id, target)` means a given event can have at most one delivery per target, ever. That is what makes `enqueue` safe to call repeatedly:

```sql
INSERT INTO deliveries (event_id, target)
VALUES ($1, $2)
ON CONFLICT (event_id, target) DO NOTHING
```

The important part is where the constraint lives. It is in the database, not in application code, so it holds when two workers run at once, when a retry races a replay, and when a future contributor forgets the rule. `remote_ref` and `remote_at` hold what the remote system assigned. We never stamp those ourselves; the proof panel shows the foreign system's id and the foreign system's timestamp.

## Claiming work

`services/mediator/src/queue.repository.ts`:

```sql
UPDATE deliveries
   SET state = 'inflight', locked_at = now(),
       attempts = attempts + 1, updated_at = now()
 WHERE id IN (
   SELECT id FROM deliveries
    WHERE state = 'pending' AND next_at <= now()
    ORDER BY next_at
    FOR UPDATE SKIP LOCKED
    LIMIT $1)
RETURNING id, event_id, target, attempts
```

`FOR UPDATE SKIP LOCKED` is what lets several workers share one table without coordination. The inner select locks the rows it picks; a concurrent claim skips the locked rows instead of blocking on them and takes the next ones. No leader, no lease broker, no distributed lock. Integration test 6 (`test/integration/pipeline.test.ts`) runs two claims concurrently and asserts that the union of their ids has no repeats.

Two details in that statement matter:

- `attempts = attempts + 1` happens at claim time, not at failure time. A worker that dies mid call still burns its attempt, so a target that kills workers cannot be retried forever.
- The partial index `deliveries_due_idx ON deliveries (next_at) WHERE state = 'pending'` keeps the inner select from scanning finished work.

The loop itself is small: `WorkerService.tick()` releases stuck rows, claims up to `BATCH_SIZE = 10`, and handles each item independently so one failing delivery cannot stop the others. `start()` runs a tick every `TICK_MS = 500`.

## Retries

`services/mediator/src/backoff.ts`:

```ts
export const BACKOFF_SECONDS = [2, 8, 30, 120, 600] as const;
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;

export function nextDelaySeconds(
  attempts: number,
  rand: () => number = Math.random,
): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const scheduled = BACKOFF_SECONDS[attempts - 1];
  if (scheduled === undefined) return null;
  return rand() * scheduled;
}
```

This is full jitter, not equal jitter: the actual delay is uniform between zero and the scheduled value, so the scheduled numbers are upper bounds. A burst of failures against one target produces a burst of failures at the same moment, and without jitter every one of them would come back in lockstep and hammer the target again together. `backoff.test.ts` pins both ends, including the case where jitter shortens a delay to zero.

The schedule is deliberately compressed. In production the first delay would be around 30 seconds and the tail would stretch over hours. Here the first two delays have to be visible inside a visitor's attention span, and the README says so instead of hiding it.

`markFailed` re-reads `attempts` from the row rather than trusting the value it was handed, computes the next delay, and either reschedules with `next_at = now() + make_interval(secs => $3)` or writes `state = 'dead'`.

## The dead letter box

After the sixth failed attempt `nextDelaySeconds` returns `null` and the row goes to `dead` with `last_error` intact. It then appears in the interface under "needs a human", with the raw error text and a retry button behind `POST /api/dead/:id/retry`.

The counter named `lost` is not computed. In `services/api/src/counters.service.ts` it is the constant `0`, and that is the entire product. A dead letter is not lost, it is visibly stuck. Conflating the two would give away the one distinction this demo exists to make.

`retryDead` resets `attempts` to `0` rather than squeezing one more try out of an exhausted row, so a visitor who presses the button watches the full schedule run again.

## Rule 6.7: the mail waits for the rest of the chain

The `mailer` delivery is not created with the others. It is created only once every other delivery for that event is `done`, and only for an event somebody asked to be written to (`services/mediator/src/completion.service.ts`):

```sql
INSERT INTO deliveries (event_id, target, state)
SELECT $1, 'mailer', 'pending'
 WHERE EXISTS (
       SELECT 1 FROM events
        WHERE id = $1
          AND coalesce(payload->>'confirmTo', '') <> '')
   AND NOT EXISTS (
       SELECT 1 FROM deliveries
        WHERE event_id = $1
          AND target <> 'mailer'
          AND state <> 'done')
ON CONFLICT (event_id, target) DO NOTHING
```

The worker calls this after every successful delivery that is not the mailer, so the check runs once per completion and the last one to finish is the one that wins the insert. `ON CONFLICT DO NOTHING` makes concurrent winners harmless.

The first of those two conditions is the younger one, and leaving it out cost the demo its own headline number. The email address is optional, so an order without one is booked under a house address that nothing can deliver to. Rule 6.7 queued a confirmation mail to it anyway: every untouched demo order failed six times, parked a dead letter, and made the page's own **needs a human** counter climb while nothing at all was wrong. No addressee, no delivery. `customerEmail` is deliberately not the field asked about here, because that one is always set and would let the bug straight back in.

The second condition is not cosmetics either. The arrival timestamp of that mail is the second witness of the proof chain for the visitor who asked for one: it is stamped by their own mail provider, in a mailbox we do not control, and it can be read out of the `Received:` header. If the mail went out alongside the other deliveries it would arrive while HubSpot is still cut, and the gap between the Stripe timestamp and the mail timestamp would measure nothing. Integration test 7 asserts both halves: no mailer row exists while a target is cut, and the mailer row reaches `done` after recovery.

It is also just correct. You confirm to a customer once everything is booked.

## Idempotency, per target

Bookkeeping in our database cannot make a foreign system idempotent. Each target has to carry its own technique, and `DeliveryTarget.deliver` takes the key as a required argument so a target without one cannot be written in the first place:

```ts
export function idempotencyKey(eventId: string, target: Target): string {
  return `${eventId}:${target}`;
}
```

| Target | Technique | Where |
|---|---|---|
| Stripe | `idempotency-key` header on `POST /v1/payment_intents`. Stripe replays the original response instead of charging twice. | `targets/stripe.target.ts` |
| HubSpot, the buyer | Natural key. Search contacts by email, then `PATCH` the existing id or `POST` a new contact. A `409` or a missing id triggers a read back, because another worker may have won the race. | `targets/hubspot.target.ts` |
| HubSpot, the order | The deal is named after the event id, and a retry searches for that name before creating one. Its basket is read back before it is written, so a retry adds only the lines a crash left missing. | `targets/hubspot.order.ts` |
| HubSpot, the catalogue | A sku is claimed in `hubspot_products` before the product is created and its id written after. Search cannot carry this: HubSpot indexes a new product about seven seconds after creating it, and the first two retry gaps are two and eight. An interrupted claim is settled by age. | `hubspot-catalogue.log.ts` |
| Slack, my workspace | No key and no natural key. The delivery embeds `idempotencyKey` as a marker in the message text and reads `conversations.history` back before posting. My own app holds `channels:history`, so this is available here and only here. | `targets/slack.target.ts` |
| Slack, your workspace | Same marker, no read. Connecting asks for `chat:write` and `incoming-webhook` only, so a row in `slack_visitor_sends` is written before the call and completed after it. | `slack-send.log.ts` |
| ledger | `UNIQUE (event_id)` on `invoices`, plus `ON CONFLICT (event_id) DO NOTHING` and a read back, so a repeat returns the original invoice number rather than an error. | `services/ledger/src/invoice.service.ts` |
| mailer | `UNIQUE (event_id)` on `sent_mail`. The claim row is inserted before the send inside a transaction and rolled back if the send throws. | `services/mailer/src/mail.service.ts` |
| custom_webhook | We send `idempotency-key` and an HMAC in `x-demo-signature`. Honouring it is the receiver's business, and that is documented rather than glossed over. | `targets/webhook.target.ts` |

The Slack technique is the weakest of the set and is labelled as such in its own file: a narrow window remains between the history check and the post. For a notification that is the right trade. For the invoice it would not be, which is why that one uses a database constraint.

### Why your workspace is handled differently

`conversations.history` requires `channels:history`. Asking a visitor for that would mean this demo could read the messages in their channel, in exchange for saving itself one database row. For a project whose entire subject is being worth trusting, that is the wrong trade, so the scope list stops at `chat:write` and `incoming-webhook`.

`incoming-webhook` is in the list on purpose and not for the webhook url. Without it `oauth.v2.access` returns no channel id at all, `target_ref` stays null and the delivery has nowhere to post. With it, Slack shows a channel picker during install and adds the app to the channel that is chosen, which also removes the `not_in_channel` error a hand-typed channel id would run into.

What that costs is one case. If the worker dies in the window between calling Slack and recording the outcome, the send log holds a row with no `message_ts` and nobody alive can say whether the message landed. Posting again might duplicate a message in someone else's Slack; giving up would lose it. So that delivery is parked in **needs a human** with the reason in plain text and the retry button beside it, and `lost` stays at 0 because parked is not lost (spec 6.6). It is the only failure in the system that skips the retry schedule, since five more attempts would each hit the same wall.

Everything the worker itself lives through, including a cut connection, clears the row and retries normally. That is what keeps the demo healing for a visitor who connected their own Slack, and it is integration test 6 in `test/integration/own-connection.test.ts`.

## The hard case: the call went out and then the worker died

This is the case the project exists for. HubSpot accepted the request, processed it, and the worker was killed before it could write `done`. Nobody knows whether it arrived.

What happens:

1. The row is stuck in `inflight` with `locked_at` set and `attempts` already incremented.
2. On the next tick, `releaseStuck(60)` puts every `inflight` row whose `locked_at` is older than 60 seconds back to `pending`.
3. It is claimed again and delivered again with the same key, because the key is derived from `event_id` and `target` and does not change between attempts.
4. The target recognises the repeat. Stripe replays its response, HubSpot finds the contact by email and patches it, the ledger returns the existing invoice number, the mailer returns the original send.

So the second call really does go out. Nothing in this design prevents that, and any design that claims to prevent it is lying: there is no way to make an HTTP call and a local write atomic across a process boundary. What is prevented is a second effect at the target. That is the honest version of exactly once, and it is why the idempotency key is in the target interface rather than in a helper somewhere.

Integration test 5 is named for exactly this: "a worker dying between call and record does not deliver twice". It delivers once, skips `markDone`, backdates `locked_at`, drains the queue, and asserts the target received one key and the row ended `done`.

## Where the failures come from

The mediator never talks to `api.hubapi.com` directly. Every target is built pointing at `${EGRESS_URL}/proxy/${target}` (`targets/index.ts`), and the gate applies the switch state on the wire (`services/egress-gate/src/proxy.controller.ts`):

```ts
if (state === 'cut') {
  request.socket.destroy();
  return;
}
if (state === 'error') {
  response.status(503).json({ error: `${target} unavailable` });
  return;
}
if (state === 'slow') {
  await new Promise((resolve) => setTimeout(resolve, SLOW_DELAY_MS));
}
```

`SLOW_DELAY_MS` is 8000 and `CALLER_TIMEOUT_MS` is 5000, so "slow" produces a genuine client timeout rather than a simulated one. "cut" destroys the socket instead of returning a tidy error body, because a tidy error body would be a stage prop.

These four states are what the menu on each system in the diagram writes, through `POST /api/switches/<target>`. It names them for somebody who is not reading this file: Reachable, Slow, Failing, Unreachable. The last two are one row apart and mean opposite things, which is the reason the menu exists at all: `error` is a system that is down, `cut` is a system that is running perfectly well behind a line that is not. The `ledger` is the exception in both directions. It is our own service, so `SwitchesController` also tells it to close its listening socket (`services/ledger/src/main.ts`), and its menu says so in words the other four do not use.

The mediator does not know a switch exists. It sees a failed HTTP call and does what it would do in production, which is why the queue behaviour on screen is worth trusting: it is not a rendering of what would happen, it is what happened.

## Checking it

- Unit tests sit next to the code in `services/*/test/`. Nine integration tests run against a real Postgres via Testcontainers in `test/integration/pipeline.test.ts`, and `test/load/soak.test.ts` pushes 10,000 events through randomly failing targets and writes its result file.
- Or ignore all of that and query the database yourself through the read only SQL console. Four views, `SELECT` only, two second statement timeout.
