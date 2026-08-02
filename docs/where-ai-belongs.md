# Where AI belongs in this demo

This page is a decision list for one problem: this repository is good evidence of integration and reliability work and almost no evidence of the thing it is meant to sell. It names five places a model could go, ranks them, and says which two are worth building. It is written the same way as [what I deliberately did not build](what-we-deliberately-did-not-build.md), so the rejections are here too, with their reasons.

## What is already in the tree

There is an AI seam and it is switched off. `services/extractor/` is a NestJS service on port 3006 with one door, `POST /internal/extract`. It takes free text, hands it to Claude Haiku with the eight rows of `products` in the prompt, and puts the answer through two checks: `orderSchema` in `schema.ts`, which is strict and rejects an invented `discountPercent` as hard as it rejects a missing email, and `findUnknownSkus` in `catalog.check.ts`, which rejects a SKU that is not in the table. `createModel` returns `null` when `ANTHROPIC_API_KEY` is empty, and the service then replays `fixtures/extractions.json`. The public demo runs that way today, and the page says so on the two menu entries that use it.

Three facts about that seam matter to everything below.

**The result is thrown away.** `ChaosService.extract` in `services/api/src/chaos.service.ts` reads `response.ok` and returns a fixed sentence. The `ExtractResult` body, with the model's raw answer and which of the two checks refused it, never leaves the api. No event is created from an extraction, ever. The extractor is a dead end with tests on it.

**Both inputs are constants.** `GARBAGE` and `HALLUCINATION_SOURCE` are string literals in `chaos.service.ts`. A visitor cannot type anything into the model.

**The hallucination is not the model's.** With `hallucinate: true` the service returns a hand written rejection naming `MUG-AZURE` and never calls the model at all. That is defensible for a button that has to work without a key, and it is not what the menu entry says: "The model returns a SKU that does not exist".

There is also a defect worth fixing whatever else happens here. In recorded mode, `recordedAnswer` falls back to `fixtures[0]` when nothing matches. `GARBAGE` says "the blue ones", not "blue mug", so it matches nothing and falls back, and `fixtures[0]` is a well formed order for `MUG-BLUE` and `COASTER-OAK`, both of which are in `products`. So the menu entry that promises "Free text the model has to make sense of, and cannot" currently produces a clean successful extraction on the live site, and the page prints the same sentence either way because that sentence is hardcoded. Nothing on screen is false. The promise is not kept.

## The test each proposal has to pass

The capital on this page is that a stranger can check every claim, and that the machine behaves the same way twice under the same failure. A model is the one component in this system that is allowed to be wrong without being broken. So a proposal earns its place only if the visitor can see the model be wrong and see what caught it. A proposal that only works when the model is right is decoration, and decoration on this page costs more than it earns, because it dilutes the one argument the page makes.

There is a second test, and it does most of the cutting. This system's failure vocabulary is closed by design. `last_error` is one of about eight strings, all written in this repository. `nextDelaySeconds` is five numbers. `isTerminal` has one case. Almost every idea of the form "put a model inside the mediator" collapses into a lookup table, because the mediator was built to be a lookup table. The only genuinely open vocabulary anywhere in the tree is text a stranger writes: the free text an order arrives as, and the response body of a visitor's own endpoint, which `webhook.target.ts` currently discards. That is where a model belongs and nowhere else.

## 1. Free text order intake, with the extraction shown and confirmed

**Build this first.**

### What it does

A textarea beside the send button in `ui/src/OrderForm.tsx`, prefilled with an example order mail and editable. Sending it calls a new api route that posts the text to `POST /internal/extract` and, unlike `ChaosService`, keeps the answer. The response carries the raw model output, the mode, and either a priced proposal or the refusal with its reason. The visitor sees the proposal and presses a second button to place it, at which point `OrdersService.place` runs with the extracted lines and everything downstream is untouched: prices still come from `products` and never from the model, the event and its four deliveries are created the way they are today, and the queue, the retries and the backlog do not know an AI was involved. A refused extraction creates no event and shows what the model said.

### Why a model and not a rule

The input is prose written by a stranger. A regex handles "three blue mugs" and dies on "2x the oak coasters, and make it the large plates this time, invoice to head office as usual". With eight products a fuzzy match would score better than it deserves, and that is worth admitting: on this catalogue a rule would get a decent share of them. What a rule cannot do at all is quantity, buyer and notes out of arbitrary sentence structure, and it cannot refuse. The stronger reason is the one this page cares about: a model is the only part of this system that fails by being confidently wrong rather than by being unreachable, and that is a second class of failure the demo does not currently show anywhere.

### What a visitor sees

Three blocks, in order: what they typed, the JSON the model answered with, and the two checks with a verdict each. Then either a proposal they can send, which turns into an ordinary card in the queue, or a refusal that names which check refused it and leaves the queue empty. The mode line the page already prints stays: in recorded mode it says the answer is replayed.

### How it fails, in public

Three failures, and all three should be reachable from the page.

The **invented article** is the one the two checks catch. Keep the chaos entry, and make it real: instead of returning a hand written rejection, send a prompt that pushes the model towards a plausible SKU that is not in the catalogue. It will not fail every time, and the page should say that a model asked to invent something may decline, because a demo that guarantees a hallucination is a stage prop.

The **plausible misreading** is the one the checks cannot catch and the most honest thing this feature can show. "A dozen coasters" read as `qty: 2` passes the schema and passes the catalogue, and there is no check in this repository that will ever catch it. That is why the confirm step exists and why it is not skippable. The page should say, next to the button, that the two checks prove the answer is well formed and that no check proves it is right, and that this is why a human presses send.

The **model itself being unreachable** is the third, and it should be broken the same way everything else on this page is broken. Point the extractor at the egress gate and give the model a tile in the diagram like the other five, with the same three states. A visitor cuts the line to Anthropic and the intake refuses cleanly with "the model could not be reached", no event, no half written order, and every order already in the queue carries on untouched. That last part is the sentence a client actually wants to hear.

### Size and cost

Roughly 350 to 450 lines across `services/api` (one controller, one service that maps an extraction onto `OrderLine[]`), `packages/contracts`, and `ui`, plus a two phase flow so the extraction is proposed and then committed. The extractor itself barely changes. One integration test that matters: a refused extraction creates no row in `events`. A per caller cap has to become real; `rate-limit.guard.ts` already records that the `model` bucket was declared and never checked, and shipping a public textarea that calls a paid api without one would be a worse mistake than the one it documents. Two to three days.

Running it is cheap. Haiku with the catalogue in the prompt is roughly 400 input and 150 output tokens per extraction, which is around a tenth of a cent. A thousand extractions a month is about a euro. The cap exists to stop abuse, not to save money.

## 2. The MCP server as the thing being demonstrated, not a footnote

### What it does

The server exists, it is read only, and the working tree is already routing it on the public host and adding tools that read the order history. What is missing is that it is presented as a checking aid at the bottom of the page rather than as the AI surface it is. Two changes. Add one tool beside the ones that are there: `integration_health`, answering how many deliveries are in each state per target, how long the oldest parked one has been waiting, and which connections are currently cut. That needs a view and a `GRANT` in a new migration, because `ngl_ro` sees views and no table, and that constraint is worth more than the tool. Then put a real session on the page: a question asked in plain English, the tool calls it produced, and the answer.

### Why a model and not a rule

There is no model in this proposal at all, which is the point. The AI is on the reader's side and belongs to them. What is being demonstrated is the thing clients are actually buying when they say they want AI: a system that an agent can be pointed at safely, where the tool boundary and the database role decide what the agent can do rather than a prompt asking it nicely. "Is anything stuck in the integration and what would I have to fix" is a question a person asks in their own words, and answering it from three tools is what an agent is for. Nobody would write a rule for it because the rule is the tools.

### What a visitor sees

The panel that is already there, and under it a short transcript of a real session: a question in plain English, the tool calls it made, the answer, and a line saying this is reproducible against the same url with any client. The transcript is a recording and must be labelled as one.

### How it fails, in public

An agent asked a question the tools cannot answer will invent one. Show that on purpose. Put a question in the transcript that the three tools cannot reach, something like "why did HubSpot fail", and show what comes back: a guess, or a refusal, depending on the client. Then state the boundary in the panel: these tools return rows, the agent's sentences about those rows are the agent's, and the rows are checkable because `backlog_list` reads `v_backlog` and so can the reader.

The second failure is the one already written into the server and should be said louder now that the port is public: nothing here writes. An agent asked to fix the backlog cannot. `retryDead` exists in the mediator, nothing public calls it, and if a retry tool ever arrives it arrives behind a key. An agent that can read a production system and cannot touch it is a much easier thing to sell than one that can do both.

### Size and cost

The smallest item on this list, and smaller again now that the routing and the order tools are in flight. One migration with a view and a grant, one tool registration, one transcript block in the panel. Half a day to a day. It costs nothing to run: the inference is the reader's, on the reader's key. The rate limiter in `services/mcp/src/rate-limit.ts` and the two second statement timeout on the role, which are what make an open port safe, are already in the tree.

## 3. A shadow advisor beside the retry decision

### What it does

After a delivery fails and `markFailed` has already written its verdict, the mediator asks a model, out of band, what it would have done with that error: retry, or park it now. The answer goes into a new table with the delivery id, the attempt, the advice, the reason and whether it agreed with the rule. Nothing about the delivery changes. The advisor is called after the row is written, its result is never read by `WorkerService`, and if it never answers the queue does not notice.

### Why a model and not a rule

For the five house targets a rule does it, and a rule already does: `hubspot.http.ts` retries 5xx and 429 and returns everything else, and `isTerminal` has exactly one case. That is the honest finding and it should be printed on the page rather than hidden, because it is the more interesting result. The one target where the vocabulary is genuinely open is `custom_webhook`, where the error text comes from a stranger's server. Today `webhook.target.ts` throws away the body and keeps only the status, so this proposal has a prerequisite: keep the body, truncated, and show it. Once it is kept, "retry this or park it" over an arbitrary error string from an unknown server is a real judgement and not a table.

### What a visitor sees

One line under the queue card of a delivery that failed: what the rule did, what the model would have done, and whether those match. Beside the panel, a running count of agreements and disagreements for the session. A disagreement is worth reading and should be openable: the error, the rule's reason, the model's reason.

### How it fails, in public

Two ways, and both are on message.

The advisor is a system like any other, so give it the tile and the three states. Cut it and the counter stops moving while every delivery in the queue continues on the same schedule, retries the same number of times and parks in the same place. That is the demonstration: the model is off and the business does not care. No other proposal on this list makes that argument as directly.

The other failure is disagreement, and the design has to make the outcome of a disagreement obvious. The rule wins, always, and the page says so in the panel rather than in this file. A visitor who sees the model say "park this" while the machine retries and recovers has learned exactly the thing that makes an AI feature safe to put next to a payment.

The risk is that the scoreboard reads 40 agreements and no disagreements and looks like a feature that does nothing. That is a fair reading and it is also the truth about this system, so the panel should say it: the model agreed with the rule every time, which is why the rule is what runs.

### Size and cost

A migration, a small advisor client in the mediator that never blocks a delivery, a tile, a panel and a query. Around 250 lines. Two days. One Haiku call per failed attempt is the cost driver, and a visitor who cuts a line generates six per delivery, so it needs a cap and it must be off in `test/load/soak.test.ts`, which pushes 10,000 events through deliberately failing targets. At demo volumes a few euros a month.

## 4. A note about what just happened

### What it does

A button under the hub. It takes the timeline entries `DeliveriesService.timeline` already produces, the switch changes, and the three counters, sends them to a model, and prints three sentences about the last few minutes: what the visitor broke, what queued behind it, how long it waited, what happened when the line came back.

### Why a model and not a rule

The input is an arbitrary interleaving of visitor actions and deliveries over an arbitrary window. A template can narrate one cut and one recovery, and it falls apart when somebody cuts two systems, sends four orders, restores one and sends two more, which takes a visitor about forty seconds. Arranging that into three readable sentences is language work.

### What a visitor sees

The note, printed next to the counters it is describing.

### How it fails, in public

It writes a happy ending that has not happened. That is the whole risk, and the design answer is a constraint rather than a better prompt: the model is given the computed figures and asked to arrange them, never to derive them, and the note is printed beside the counters, so every number in it is one line away from the number the page computed. A reader who wants to catch it wrong has to look down, not open a console.

Then give them a reason to. The button should be pressable in the middle of an outage, and the note should then say the machine is still holding deliveries. A visitor who presses it while HubSpot is cut and reads "everything recovered" beside a counter reading two waiting has caught the model lying, on the page, with the evidence next to it. That is a better demonstration than any correct note.

### Size and cost

One api route, one model call, one panel, no schema change. A day. A couple of thousand tokens per press, so a fraction of a cent.

The cost that is not measured in money: this page already narrates itself, in `activity.ts` and in `DeliveriesService.describe`, in sentences that are computed and therefore true. Adding prose a model wrote to a page whose capital is verifiability is a real trade, and it is why this is fourth and not second.

## 5. Natural language chaos control

**Do not build this.**

### What it does

A text box that accepts "break HubSpot for the next two orders" and sets switches accordingly.

### Why a model is not the right tool

Because the whole command space is five targets by three states, which is fifteen commands, and they are already on screen as menus. The half of the sentence that is not in those fifteen, "for the next two orders", is not an AI problem at all: switches have no scope in this system, only the ten minute reset in `autoreset.service.ts`, so building it means building scoped switches, which is deterministic plumbing wearing an AI hat.

It also argues against the page. `machine.ts` spells out that Failing and Unreachable are one row apart and mean opposite things, and the menu exists to teach that difference in words at the moment a visitor chooses. A text box hides exactly that. The refusal of a settings page in [what I deliberately did not build](what-we-deliberately-did-not-build.md) is the same argument: if a knob matters it belongs on the thing it acts on.

### How it would fail

A misparse breaks a different system than the one the visitor asked for. There is one world here and no multi tenancy, so that misparse lands on everybody who is on the page, and the visitor who typed it has no way to tell a misparse from a system that was already cut by somebody else. It is the one proposal on this list whose failure mode is invisible to the person who caused it, which is the opposite of what this demo is for.

## Rejected outright

### The parked delivery's error, turned into one sentence for a human

This is the proposal that sounds best and is a lookup table. Here is the entire error vocabulary of this repository, from the targets:

| Written where | The string |
|---|---|
| `stripe.target.ts` | `Stripe responded 503` |
| `hubspot.http.ts` | `HubSpot responded 503` |
| `hubspot.order.ts` | `HubSpot took the deal but named no id` |
| `hubspot.catalogue.ts` | `HubSpot refused the product for MUG-BLUE with 400` |
| `slack.target.ts` | `Slack responded 503`, `Slack error: missing_scope` |
| `ledger.target.ts` | `Ledger responded 503` |
| `mailer.target.ts` | `Mailer responded 503` |
| `webhook.target.ts` | `no custom webhook url configured`, `Your endpoint responded 404` |
| the runtime | `fetch failed`, and the timeout from `AbortSignal.timeout` |

Every one of those maps to one fixed sentence. A table does it, deterministically, offline, at no cost, and can be unit tested, which a paraphrase cannot. `activity.ts` already carries the observation this rests on: `lastError` is a driver's sentence about a socket, which belongs in the backlog entry and not on a tile. The right fix is a mapping in the same file, and it is not an AI feature. Calling it one would be the exact decoration this page cannot afford.

If `webhook.target.ts` ever keeps the response body from a visitor's own endpoint, this vocabulary opens up, and the answer is still to show the body rather than to paraphrase it. The judgement over that body is proposal 3.

### Catalogue reconciliation between the local catalogue and HubSpot

Matching "Blue mug" against a HubSpot product called "Mug, blue, 12oz" is the sort of fuzzy work a model is genuinely good at, and it is a job clients really do pay for. It has no place here, because `hubspot.catalogue.ts` matches on `hs_sku` with an exact filter and a claim book, which is a natural key and always right. To demonstrate a model doing better, the portal would have to be seeded with mismatched products on purpose, and a divergence manufactured for the camera is a stage prop.

### An agent that can put deliveries back in the queue

The MCP server is read only and not merely by convention: it holds the `ngl_ro` url and no other credential, and it is the only service of ours with no `env_file` in `docker-compose.yml`. Handing an agent a tool that moves other people's parked work through an anonymous public port would trade the strongest sentence in this repository for a demo of an agent pressing a button. If a retry tool arrives it arrives behind a key, and it is a key that belongs to whoever runs this.

## If there is time for two

Build 1 and 2.

They are the two ends of the same argument and neither of them asks the reader to believe anything new. Number 1 puts a model in front of the machine, where it can be wrong in public and be caught by checks that are already written and already tested. Number 2 puts the machine behind an interface an agent can use, where the safety comes from a database role rather than a prompt. Together they say the thing worth saying: a model reads the input, deterministic code does the work, and an agent can read the result without being able to touch it.

Number 5 is the one not to build at any point.
