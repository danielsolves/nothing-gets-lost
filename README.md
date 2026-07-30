# Nothing Gets Lost

![The control panel with a target cut and the queue holding](docs/demo.gif)

[![CI](https://github.com/OWNER/nothing-gets-lost/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/nothing-gets-lost/actions/workflows/ci.yml)

When two systems talk to each other, things go missing. A payment arrives but the
customer never appears in the CRM. A form is submitted but no invoice is written.
Nobody notices until somebody asks three weeks later.

**This is a live lab for that problem. Break it on purpose and watch nothing get lost.**

→ **[Try it](https://ngl.danielsolves.ai)** · switch a system off, place an order, switch it back on.

## What you can check yourself

You do not have to take my word for any of it:

| | |
|---|---|
| **Stripe receipt** | a page served by stripe.com, not by this demo |
| **Confirmation mail** | lands in your inbox; the `Received` header is stamped by your provider |
| **The proof chain** | the gap between those two timestamps is the outage you caused |
| **SQL console** | query the database yourself, read-only |
| **Your own endpoint** | give it a url and see the retries arrive on your server |
| **Your own Slack** | connect a workspace and the notification appears in the channel you pick |
| **Your own HubSpot** | connect a portal and the contact appears in your CRM, with HubSpot's own `hs_createdate` |

Connecting is optional and lasts 24 hours. Slack is asked for `chat:write` and
`incoming-webhook`, HubSpot for `crm.objects.contacts.read` and `.write`, and nothing
else. There is a **Disconnect** button, and the token is deleted rather than merely
ignored.

The read-back against **my** HubSpot portal is an indication, not proof. I render that
answer, so you would be right not to trust it. It is labelled as such in the interface.
Everything in the table above is not.

## Run it

```bash
git clone https://github.com/OWNER/nothing-gets-lost
cd nothing-gets-lost
cp .env.example .env
docker compose up
```

Open http://localhost:5173. **No API keys required.** Without a model key the reading
step replays recorded answers and says so on screen; without Stripe, HubSpot, Slack or
SMTP credentials those targets simply fail and retry, which is a legitimate thing to
watch. Fill in `.env` when you want the real ones.

## How the failures work

The control panel really does break things:

| Switch | What actually happens |
|---|---|
| reachable | the call goes through |
| slow | the gate holds the request for 8s; the caller times out at 5s |
| error | a real 503 |
| cut | the socket is destroyed, so the caller sees a real `ECONNRESET` |

HubSpot, Stripe and Slack keep running. **We simply stop being able to reach them**,
which is the most common real outage, far more common than a provider going down. The
invoice service is the exception: it closes its listening socket, so there "off" is
literal.

The mediator does not know any of this happened. It sees a failed HTTP call and does
what it would do in production.

## The numbers on the box

`10,000 events · 0 lost · 0 duplicated`, produced by
[`test/load/soak.test.ts`](test/load/soak.test.ts). The result is written to
[docs/load-test-result.txt](docs/load-test-result.txt) by the run itself, and CI
regenerates it as its own job.

The nine scenarios from the specification are in
[`test/integration/pipeline.test.ts`](test/integration/pipeline.test.ts): a repeated
webhook, a cut target, a returning target, six failures reaching the dead letter box, a
worker dying between the call and the record, two workers racing for the same row, the
confirmation mail waiting for the chain, reviving a dead letter, and `lost` staying at
zero through arbitrary chaos.

## Honest caveats

- **The retry schedule is compressed.** 2s, 8s, 30s, 2min, 10min. In production I would
  start at 30s and stretch over hours. The first delays have to be visible inside a
  visitor's attention span.
- **There is one world, not one per visitor.** If somebody else is experimenting you
  will see their traffic, and the page says so. Per-visitor sandboxes would mean the
  switches were not really switching anything.
- **Slack deduplication is weaker than the rest.** In my workspace it reads the channel
  back before posting, which leaves a narrow race. For a notification that is the right
  trade; for the invoice it would not be, which is why that one uses a database
  constraint. In your workspace it cannot read at all, which is the next point.
- **In your Slack, an interrupted send is parked rather than repeated.** Connecting
  asks for `chat:write` and `incoming-webhook`, and for nothing that reads your
  messages. So if this demo dies in the moment between calling Slack and recording the
  result, nobody can establish whether the message arrived. Rather than push a possible
  duplicate into your workspace, that delivery goes to **needs a human** with the
  reason written out. `lost` still reads 0, because parked is not lost.
- **The queue is hand-built on purpose**, and that is not general advice. See
  [why no queue library](docs/why-no-queue-library.md).

More: [how it works](docs/how-it-works.md) ·
[why no queue library](docs/why-no-queue-library.md) ·
[what I deliberately did not build](docs/what-we-deliberately-did-not-build.md)

## Licence

MIT
