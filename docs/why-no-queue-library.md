# Why there is no queue library here

This page explains why this repository writes its own queue instead of using BullMQ, Redis or Kafka, and it is for anyone who read that decision and assumed it was ignorance or fashion. It ends with the case against doing what this repo does.

## The reason, in one paragraph

The queue is the product. This project exists to show a visitor what "nothing gets lost" actually consists of: a claim that two workers cannot both win, a retry schedule with jitter, a uniqueness constraint that survives a crash, a dead letter box that is visibly not the void. A library does all of that well and does it somewhere you cannot see. `queue.add()` and `new Worker(...)` are two lines that hide the six mechanisms this demo was built to expose. If I had used one, the interesting part of the repository would be a dependency in `package.json`.

## What that costs and what it buys

Counted from the working tree, the queue is four files:

| File | Lines | Without comments and blank lines |
|---|---|---|
| `services/mediator/src/queue.repository.ts` | 150 | 107 |
| `services/mediator/src/worker.service.ts` | 108 | 82 |
| `services/mediator/src/completion.service.ts` | 43 | 22 |
| `services/mediator/src/backoff.ts` | 22 | 11 |
| **Total** | **323** | **222** |

Add `intake.service.ts` (63 lines, 46 without comments) if you count deduplication at the door as part of the queue, which is fair.

That is the whole thing. There is no scheduler process, no broker, no Lua script, no serialisation format, no separate Redis to keep alive. There is one Postgres table, one `UPDATE ... FOR UPDATE SKIP LOCKED`, and a `setInterval`. A reader who wants to know how a delivery gets picked up reads 30 lines and knows. A reader who wants to know what happens when a worker dies reads `releaseStuck` and knows.

There is a second, less romantic benefit. The queue and the business data share one database and one transactional world. Enqueuing a delivery is an ordinary insert next to the order row, so there is no outbox pattern, no dual write, and no window where the order exists and its deliveries do not.

## What a library would have hidden

Concretely, these are the decisions a reader can inspect here that would otherwise sit behind an API:

- Attempts are incremented at claim time rather than at failure time, so a worker that is killed mid call still burns its attempt.
- The retry schedule is full jitter (`rand() * scheduled`), not equal jitter, and there is a test that asserts a delay can be shortened all the way to zero.
- Stuck rows are recovered by a fixed 60 second `locked_at` threshold, not by a heartbeat.
- Uniqueness is a database constraint, `UNIQUE (event_id, target)`, and not an in memory set or a Redis key with a TTL.
- The confirmation mail is enqueued by a conditional insert that runs after every other completion, which is a rule you would otherwise have to express as a job chain or a flow.

Each of those is a place where a real integration goes wrong. None of them are visible in a `queue.add()` call.

## When not to do this

If you are building something real and under load, use a proven library. This is not false modesty, it is the actual recommendation, and here is the specific reasoning.

**This queue polls.** `WorkerService.start()` runs a tick every 500 milliseconds, and `claimDue` takes at most 10 rows. That sets a latency floor, it puts a constant write load on the database whether or not there is work, and it scales badly: twenty workers polling one table are twenty `UPDATE` statements per half second competing for the same hot rows. BullMQ blocks on Redis and wakes on arrival. That difference gets expensive well before it gets interesting.

**It has one dial and no others.** There are no priorities, no per target rate limits, no concurrency caps, no delayed jobs beyond `next_at`, no cron, no job groups, no pause and resume, no queue metrics. Every one of those is a real requirement in a real system, and every one of them is a week of work and a new class of bug if you write it yourself.

**Its failure envelope is narrow and known.** It has been exercised at 5,000 events in one process with a fixed pseudo random failure pattern (`test/load/soak.test.ts`). BullMQ, Sidekiq and Kafka have been exercised by thousands of production systems for years, including the failure shapes nobody thinks to write a test for. That difference is not something a careful author can close by being careful.

**Postgres as a queue has a ceiling.** `SKIP LOCKED` is a genuinely good pattern and it holds up to a real amount of traffic, but dead tuples from a high churn queue table put pressure on autovacuum, long running readers block cleanup, and the table that was a convenience at a thousand jobs an hour becomes the thing your DBA pages you about. When you get there, moving the queue out of the database is the right answer, not tuning the hand written one.

**Nobody else knows your queue.** A new engineer knows what BullMQ does. Nobody knows what your `markFailed` does until they read it, and they will read it during an incident.

The honest rule of thumb: write your own queue when the queue is the thing you are trying to explain, when the volume is small and the operator is you, or when you need exactly one behaviour and can afford to own it. Otherwise take the library and spend the saved time on the part the library cannot do for you.

## The part no library does for you

Which is idempotency at the target. That is worth separating out, because it is the most common misreading of this whole argument.

A queue library gives you at least once delivery. It does not, and cannot, stop a second call from having a second effect on someone else's system. The hard case from `how-it-works.md` (the call went out, the target processed it, the worker died before recording success) looks identical whether the queue is 222 lines of Postgres or a Kafka cluster. Someone still has to decide that Stripe gets an idempotency key, HubSpot gets its natural key, the invoice gets a unique constraint, and Slack gets a history check with a documented race.

So if you replace this queue with BullMQ tomorrow, `services/mediator/src/target.interface.ts` and everything under `targets/` stay exactly as they are:

```ts
export interface DeliveryTarget {
  readonly target: Target;
  deliver(ctx: DeliveryContext): Promise<DeliveryOutcome>;
}
```

`DeliveryContext` carries a required `idempotencyKey`, which means a target without an idempotency story cannot be written. That constraint is the transferable part of this repository. The queue underneath it is the teaching aid.
