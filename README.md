# Nothing Gets Lost

[![CI](https://github.com/danielsolves/nothing-gets-lost/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/danielsolves/nothing-gets-lost/actions/workflows/ci.yml)

![An order runs through five systems, HubSpot is cut with a click, waiting climbs and lost stays at zero](docs/demo.gif)

When two systems talk to each other, things go missing. A payment arrives but the
customer never appears in the CRM. A form is submitted but no invoice is written.
Nobody notices until somebody asks three weeks later.

**This is a live lab for that problem. Break it on purpose and watch nothing get lost.**

→ **[Try it](https://ngl.danielsolves.ai)** · send an order, open the menu on any system and break it, watch it come back.

## What you can check yourself

You do not have to take my word for any of it:

| | |
|---|---|
| **Stripe receipt** | a page served by stripe.com, not by this demo |
| **Confirmation mail** | lands in your inbox; the `Received` header is stamped by your provider |
| **Your own endpoint** | give it a url and every delivery is posted there too, retries and all |
| **The backlog** | point your own MCP client at `https://ngl.danielsolves.ai/mcp` and read the parked deliveries out of the database |

The first three put the evidence somewhere I do not control, which is the only
property that makes a claim worth anything. The fourth does not pretend to: the backlog is my
database, and what the MCP server buys you is that you read the rows with your own
client instead of reading my rendering of them. That server answers on the public
host over streamable HTTP, read only, and on a copy you run yourself.

There is no read-back button on **my** HubSpot portal, **my** Slack workspace or
**my** ledger. Those are read back through my own account with my own token, so the
answer would be a page I rendered about data I hold, and a check that has to admit
that spends the credibility of the two that do not. The button is offered on Stripe
and on the confirmation mail, and nowhere else.

A visitor could once connect their own Slack workspace and their own HubSpot portal
and have the deliveries land there instead. That is gone, and the reasoning is in
[what I deliberately did not build](docs/what-we-deliberately-did-not-build.md). The
url field above does the same job with no login, no scopes and no token of yours in
my database.

## Run it

```bash
git clone https://github.com/danielsolves/nothing-gets-lost
cd nothing-gets-lost
cp .env.example .env
docker compose up
```

Open http://localhost:5173. **No API keys required.** Without a model key the reading
step replays recorded answers and says so on screen; without Stripe, HubSpot, Slack or
SMTP credentials those targets simply fail and retry, which is a legitimate thing to
watch. Fill in `.env` when you want the real ones.

## How the failures work

Every system in the diagram carries the control that breaks it: three dots in the
corner of its tile, and under them the three states it can be put into. It really does
break things:

| Menu entry | What actually happens |
|---|---|
| Reachable | the call goes through |
| Slow | the gate holds the request for 8s; the caller times out at 5s |
| Unreachable | the socket is destroyed, so the caller sees a real `ECONNRESET` |

There is no entry for a system that is down. Nothing here can take HubSpot or Slack
down: the gate would answer the 503 in their place, and the menu would be stating as
fact something true of my own container and false of the system it names. What is
left is what really happens to a connection. **Unreachable** is a system that is running
perfectly well behind a line that is not: HubSpot, Stripe and Slack keep going, **we
simply stop being able to reach them**, and that is the most common real outage, far
more common than a provider going down. The invoice service is the exception: it
closes its listening socket, so there "off" is literal, and its menu says so in its
own words.

The Stripe menu carries the one-off mischief as well: the repeated payment sits
there, where a duplicate webhook would come from. The two malformed orders are not
something a system does to us, so they sit under the button that sends an order, as
the second and third thing it can send.

The mediator does not know any of this happened. It sees a failed HTTP call and does
what it would do in production.

## The backlog

Six attempts, growing gaps, and then what? A delivery that cannot be made is not
dropped and it is not retried forever. It is written to a **backlog**, and it stays
there until a person deals with it. The hub keeps it beside the queue and the log,
and the order card says where the delivery went too.

That is a claim, so here is a way to check it that does not involve believing the
page. The MCP server answers out of `v_backlog`, which selects the same parked rows
the panel lists, straight from the database:

| Tool | What it answers |
|---|---|
| `backlog_list` | what is waiting, oldest first, with how many there are |
| `backlog_entry` | one of them in full, with the order and the basket behind it |

```bash
claude mcp add --transport http ngl https://ngl.danielsolves.ai/mcp
```

That is the public host, streamable HTTP and read only, and any MCP client will do.
Running the demo yourself gets you the same server on `http://localhost:3007/mcp`,
and the shorter route besides, `SELECT * FROM v_backlog`, which is where both tools
read from.

The server is **read only**, and not merely by convention. It is handed the `ngl_ro`
url and no other credential at all, not even the writing one, and it is the only
service of mine that gets no `env_file` in the compose file. So the strongest
sentence about the open port is not that it has no write tools, it is that it holds
nothing that could write. The role itself sees five views and no table, which means
the guarantee survives a hole in the server. Putting a delivery back in the queue is
a real action and it belongs to whoever runs this demo: `retryDead` in the mediator
does it, nothing public calls it, and if it ever arrives here it arrives behind a key.

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
- **Your email address is optional, and the specification says it should not be.**
  Section 9.7 makes it mandatory and calls it the strongest proof, which it is. It is
  optional here anyway, because somebody should be able to watch a real order run all
  the way through before handing anything over: the order the big button sends asks
  you for nothing. What you give up by leaving the address out is the confirmation
  mail, and with it a timestamp stamped by your own provider rather than by me. The
  evidence then rests on one witness who is not me, the Stripe receipt, instead of
  two. Give an address and you get both.
- **There is one world, not one per visitor.** If somebody else is experimenting you
  will see their traffic, and the page says so. Per-visitor sandboxes would mean the
  switches were not really switching anything.
- **Slack deduplication is weaker than the rest.** The delivery reads the channel back
  before posting to recognise its own marker, which leaves a narrow race between the
  read and the post. For a notification that is the right trade; for the invoice it
  would not be, which is why that one uses a database constraint.
- **The queue is hand-built on purpose**, and that is not general advice. See
  [why no queue library](docs/why-no-queue-library.md).

More: [how it works](docs/how-it-works.md) ·
[why no queue library](docs/why-no-queue-library.md) ·
[what I deliberately did not build](docs/what-we-deliberately-did-not-build.md)

## Licence

MIT
