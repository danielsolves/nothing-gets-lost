# How it works

This page follows one order from the moment it arrives to the moment the confirmation mail goes out, and it is written for a developer who wants to see whether the guarantees are real or decorative.

## The path of one order

1. An order reaches `services/api/src/orders.service.ts` through one of two doors. `POST /api/demo-order` carries nothing at all: it is the button in the opening, and it uses the `DEFAULT_BASKET` from `@ngl/contracts`. `POST /api/orders` carries the basket a visitor chose, and their name and email address if they typed them. Either way the total is computed from the `products` table, never from the request body: a visitor who posts a zero cent order would otherwise produce a Stripe receipt that proves nothing. An address that is there is validated, a blank one is not a mistake to be told about, and the payload keeps the two cases apart in two fields rather than one. `customerEmail` is the identity the order is booked under, always set, falling back to a house address, because Stripe wants one for the receipt and HubSpot uses it as the natural key below. `confirmTo` is the promise of a mail, and rule 6.7 is the only rule that reads it.
2. The api does not write the queue. It hands the event to the mediator over `POST /internal/enqueue` (`services/api/src/mediator.intake.ts`), so the exactly once rules live in exactly one process. The page calls this service the **Integration hub**, because a visitor should not have to be told what a mediator is before the panel means anything; the code keeps `mediator` everywhere, because that is what the pattern is called. Below, the service is the mediator and the thing on screen is the hub. `EnqueueController` rejects anything that is not `{ externalId, kind, payload, targets[] }` with a known kind and known targets: a bad target would sit in the queue forever with no worker registered for it.
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

The important part is where the constraint lives. It is in the database, not in application code, so it holds when two workers run at once, when a retry races a replay, and when a future contributor forgets the rule. `remote_ref` and `remote_at` hold what the remote system assigned. We never stamp those ourselves; the check button on a delivered step shows the foreign system's id and the foreign system's timestamp, and where that system serves a page of its own the button offers the link rather than the identifier.

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

Independently also means at the same time. The claimed batch goes through `Promise.all`, not a loop, so the four deliveries an order asks for leave together and the order costs the slowest of them rather than the sum of all four. The systems know nothing about each other, and a chain would be a claim that they do: HubSpot does not need to hear that Slack has the message. The fan out is bounded by `BATCH_SIZE`, and each delivery holds a pooled connection only for the length of a single statement, because the waiting happens inside `target.deliver`, which holds none. The one real ordering in this system is the confirmation mail, and it is not expressed in the worker at all; it is the subject of rule 6.7 below.

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

## The backlog

After the sixth failed attempt `nextDelaySeconds` returns `null` and the row goes to `dead` with `last_error` intact. That is the backlog. It is the third thing the hub holds, beside the queue and the log, and the order card names it too: both say that the delivery was written there and that a person has to review it, and the "needs a human" counter counts it.

The counter named `lost` is not computed. In `services/api/src/counters.service.ts` it is the constant `0`, and that is the entire product. A parked delivery is not lost, it is visibly stuck. Conflating the two would give away the one distinction this demo exists to make.

The backlog can be read without going through the page at all, against `v_backlog` (migration `014`), which is built on `v_events` and `v_orders` so the email masking is written once. `services/mcp/` serves it as two tools, `backlog_list` and `backlog_entry`, over the streamable HTTP transport on `POST /mcp`, port 3007. Nothing about the transport is stateful: a fresh server and transport per request, no session id, because every call is a question about the database at that moment. It is routed on the public host, at `POST https://ngl.danielsolves.ai/mcp`, and the built page proxies the same path on its own origin (`ui/nginx.conf`), so a copy you are running yourself has it on `http://localhost:5173/mcp` without needing the container's own port. Either way `SELECT * FROM v_backlog` is the shorter route to the same rows.

The MCP process reads as `ngl_ro`, the role from migration `005`: read only at the role level, six views, no table, two second statement timeout. It is given that url and no other credential, and it is the only service running our code that gets no `env_file` in `docker-compose.yml`, so the strongest thing to say about the open port is not that the server exposes no write tools but that it holds nothing that could write.

`retryDead` in the queue repository is the way back. It resets `attempts` to `0` rather than squeezing one more try out of an exhausted row, so a revived delivery gets the whole schedule again. Nothing on the public surface calls it: putting other people's work back in the queue is not something an anonymous visitor should be able to do, and the MCP server is read only for the same reason.

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

The second condition is not cosmetics either. The arrival timestamp of that mail is the second of the two witnesses that are not us, for the visitor who asked for one: it is stamped by their own mail provider, in a mailbox we do not control, and it can be read out of the `Received:` header. If the mail went out alongside the other deliveries it would arrive while HubSpot is still cut, and the gap between the Stripe timestamp and the mail timestamp would measure nothing. Integration test 7 asserts both halves: no mailer row exists while a target is cut, and the mailer row reaches `done` after recovery.

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
| Slack | No key and no natural key. The delivery embeds `idempotencyKey` as a marker in the message text and reads `conversations.history` back before posting, which is why the app holds `channels:history` as well as `chat:write`: without the read scope every Slack delivery fails with `missing_scope`. | `targets/slack.target.ts` |
| ledger | `UNIQUE (event_id)` on `invoices`, plus `ON CONFLICT (event_id) DO NOTHING` and a read back, so a repeat returns the original invoice number rather than an error. | `services/ledger/src/invoice.service.ts` |
| mailer | `UNIQUE (event_id)` on `sent_mail`. The claim row is inserted before the send inside a transaction and rolled back if the send throws. | `services/mailer/src/mail.service.ts` |
| custom_webhook | We send `idempotency-key` and an HMAC in `x-demo-signature`. Honouring it is the receiver's business, and that is documented rather than glossed over. | `targets/webhook.target.ts` |

The Slack technique is the weakest of the set and is labelled as such in its own file: a narrow window remains between the history check and the post. For a notification that is the right trade. For the invoice it would not be, which is why that one uses a database constraint.

There used to be a second Slack row in that table. A visitor could connect their own workspace, and a delivery then went there instead of into the house channel, with `chat:write` and no read scope: no history to check, so a row in `slack_visitor_sends` stood in for the answer the channel could not give. That path is gone with the visitor OAuth, and so are the table and the log it needed. The reasoning is in [what I deliberately did not build](what-we-deliberately-did-not-build.md); what belongs here is that taking one branch out of the delivery path took a whole idempotency technique with it.

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
- Or ignore all of that and read the database. `DATABASE_URL_READONLY` in `.env.example` is the `ngl_ro` url, which is `SELECT` on six views and nothing else, and it works from `psql` exactly as it works from the MCP server. There was a SQL console on the page for a while and there is not any more, for a reason worth reading before rebuilding it: [what I deliberately did not build](what-we-deliberately-did-not-build.md).
