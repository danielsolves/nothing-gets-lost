# The tile carries the menu, and the picture gains its sources

Date: 31 July 2026
Status: approved in conversation, built in the same session

## Why

The previous note ([the diagram becomes the
demo](2026-07-31-interactive-diagram-design.md)) put the controls on the drawing: a
click on a target cut its line, another click put it back. It kept the full range in
a drawer at the bottom of the page called "Control panel", on the reasoning that cut
and restore is the one dramatic action a first-time visitor needs.

That split turned out to cost more than it saved, in three ways.

**The toggle flattened four faults into two.** Specification section 7 has four
states, and the pair worth teaching is exactly the pair a toggle loses. A system that
answers 503 is down. A system behind a dead line is running perfectly well and we
merely cannot reach it, which the README itself calls the most common real-world
outage, far more common than a provider failing. A visitor who only ever sees "cut"
learns that an outage is one thing.

**The drawer was a second copy.** Everything in it acted on a system drawn a screen
higher up, and two places holding the same switches is one place too many: the day
they drift apart, one of them is lying about the machine.

**Orders came out of nowhere.** Specification section 4 has two ways in, a shop page
and a free-text order mail read by the extractor. The diagram drew only the outgoing
half, so an order appeared in the middle of the picture with nothing before it, and
the two mischief buttons that act on the incoming mail sat in the drawer under a
heading that said nothing about where they landed.

## What changes

**The tile stops being a toggle and grows a menu.** Three dots in its corner, and
under them the four states in words, each with what it actually does:

| Entry | What it says | What the gate does |
|---|---|---|
| Reachable | Calls go straight through | passes the call on |
| Slow | Answers eight seconds late, so the call times out | holds it 8s against a 5s limit |
| Failing | The system is down and answers 503 | a real 503 |
| Unreachable | The line is dead. The system itself is fine | destroys the socket, real `ECONNRESET` |

The last two are the point of the whole control. They are one row apart and they mean
opposite things, and the only way to teach that is to let a visitor pick each of them
by name and watch the same queue survive both.

**Invoices says something different, because something different is true.** The
`ledger` is our own service and is the one target where off means off: it closes its
listening socket rather than being cut at the gate (specification 7). Its fourth
entry therefore reads "The service really stops listening. This one is off, not just
unreachable." Saying the same sentence about it as about the other four would be
false about one of them, and it would be false about the one the sentence was written
to defend.

**The menu button is deliberately not hover-only.** Hover is a pointer, and
specification section 1 says the typical visitor may well arrive from a phone. The
button is always in the DOM and merely quiet: half opacity until the tile is
approached by a pointer, a keyboard or a finger. A control that appears on hover is
not a quiet control, it is an absent one for everybody without a mouse.

**The cost, and why it was paid.** Breaking something now takes two clicks rather
than one: open the menu, choose the fault. That is a real loss against the success
criterion in section 1, which gives a stranger sixty seconds to break something on
purpose. It was accepted because the menu teaches the difference between the faults,
and one click cannot. The loss is softened where it can be: the button sits on the
tile the visitor is already looking at, the hint under the opening action names it,
and the fault in force is written back onto the tile, so the menu is also the readout.

**The three one-off actions move to the tile they act on.** "Deliver the payment
twice" belongs to Stripe, because a repeated webhook is a thing Stripe does to us in
the first place; read on that tile it is a question about that system. "Send a
half-written order" and "Make the AI invent an article number" belong to the order
mail, because that is the way in they arrive by.

**Sources are drawn.** Sources on the left, targets on the right, the mediator
between them, and a line along every hop. Both ways in from section 4 are now on the
picture, so an order enters the machine somewhere a visitor can point at.

**The shop page has no menu.** It would be a second control doing what the page's own
loud button already does, and this project has already rejected having two things
telling a visitor what to do; that is why the five-step walkthrough went. So the shop
page is drawn, joined by a line, and left alone.

**The two mischief actions on the mail source report what came back.** Both go
straight to the extractor, exactly as an incoming mail would, and neither creates an
event. So nothing about them turns up in the queue, in the log or in the counters,
which meant that until now those two buttons did nothing a visitor could see. The
answer from
`POST /api/chaos/<kind>` is now written onto the tile that fired it, and that is the
only evidence there is that the press did anything.

**The control panel drawer is gone entirely.** It held only a second copy of controls
that now sit on the drawing. Two things came up with it rather than going away:

- **Reset everything** moved into the mediator hub, beside the counters it puts back
  to zero.
- The fine print, "Every action here is real. Stripe runs in test mode with real
  webhooks. HubSpot is up. We simply stop being able to reach it, which is the most
  common real-world outage", moved under the diagram. It is the sentence that stops a
  visitor reading the whole page as an animation, and it belongs next to the thing it
  is about.

The tabs at the bottom keep the two that were never duplicates: connecting your own
systems, and the read-only SQL console.

**The order form moves from the bottom of the page into the opening, and both its
fields become optional.** It was two things in two places: a loud button at the top
that sent a fixed order, and a section at the very end of the page called "Place your
own order" that asked for a basket and a mandatory address. A visitor who wanted
their own order in the picture had to scroll past the entire demo to find it. It is
one button now, with the detail folded away behind "Make it your own order": press it
untouched and the plain order goes through `POST /api/demo-order`, which asks for
nothing at all; open the panel and the basket starts from the same default rather
than from empty, and the name and the address are both marked as optional in the
placeholder text itself.

This is a deliberate departure from specification 9.7, which makes the address
mandatory and calls it the strongest proof. Owner's decision: a visitor should be
able to watch a real order go all the way through before handing anything over.
Section 9.7 is right about what the address buys, and nothing is taken away by making
it a choice: give one and the confirmation mail is still the second witness of the
proof chain, stamped by the visitor's own provider rather than by us. The README
carries the caveat, including what is given up by leaving it out.

The default basket moved into `@ngl/contracts` as `DEFAULT_BASKET` for the same
reason the copy moved into `machine.ts`: the plain order and the customised order
must not be able to drift apart quietly.

**The bug that departure exposed.** An order still has to be booked under some
address, so one without one is booked under a house address. Rule 6.7 then queued a
confirmation mail to that house address, which is unreachable by design, so every
demo order failed six times and parked a dead letter. The page's own "needs a human"
counter climbed while nothing at all was wrong.

The payload now carries two fields where it carried one:

| Field | Meaning | When it is set |
|---|---|---|
| `customerEmail` | the identity the order is booked under | always, house address if nobody gave one |
| `confirmTo` | the promise of a mail | only when a real person typed an address |

`customerEmail` has to be there because Stripe wants it for the receipt and HubSpot
uses it as the natural key that makes exactly-once work: it is what lets a retry find
the existing contact instead of creating a second one. Rule 6.7 asks about
`confirmTo`. No addressee, no delivery, and therefore no dead letter for a mail
nobody was ever promised.

## Structure

| Unit | Job | Depends on |
|---|---|---|
| `machine.ts` | every word the diagram may say about a system, as data | nothing |
| `TileMenu` | the three dots, the popup, the keyboard and pointer behaviour | nothing |
| `Diagram` | lay out sources, hub and targets, wire the menus to the endpoints | `machine.ts`, `TileMenu` |
| `Mediator` | the hub panel, now also the home of the reset | nothing new |
| `OrderForm` | the one button, and the panel of detail behind it | `DEFAULT_BASKET` |

The copy lives in `machine.ts` rather than inside the components because copy is the
part most likely to drift back into vagueness, and there it can be asserted without
rendering anything. `faultsFor(target)` is the one place that knows Invoices is
different.

Nothing on the server changes for any of this. `POST /api/switches/<target>`,
`POST /api/chaos/<kind>` and `POST /api/reset` all existed and are called as they
were; the drawer and the tiles were always two front ends onto the same three
endpoints. The payload change above is the one server-side edit, and it sits in
`orders.service.ts` and `completion.service.ts`.

## On a phone

The drawing keeps the quarter turn from the previous note and gains a row: sources
first, then the mediator, then the targets, in the order the work travels. The wire
between each pair turns upright. Tiles stay full width and side by side in pairs so
that no one of them reads as the next one's cause, because these deliveries go out in
parallel and a layout that fits while saying something false about the system is
worse than one that needs a scroll.

The menu itself is capped at `min(19rem, 78vw)` so it cannot leave the screen on the
tile nearest an edge, and it is dismissed by a press anywhere else on the page as
well as by Escape.

## What stays

The four states are unchanged, and so is the `egress-gate` that implements them. The
counters, the queue, the log, the proof panel, the SQL console, the connection
buttons and the ten-minute auto-reset are untouched. Cut and restore are still one
menu entry each; what changed is that they are no longer the only two.

## Testing

Copy first, since it is the reason the control exists. `machine.test.ts` asserts that
every state the gate accepts is offered, that each entry says what it does rather
than only what it is called, that "Failing" and "Unreachable" cannot read the same
way again, and that Invoices says off means off in words the others do not use.

`TileMenu.test.tsx` asserts the rule that must not break: the button is in the DOM
before anything is hovered. Then the ordinary menu behaviour, named, opening,
closing on Escape and on a press elsewhere, focus moving in and coming back, and the
state group carrying radio semantics so the entry in force is announced as chosen.

`Diagram.test.tsx` covers the wiring: both sources drawn, a source carrying no state
because a source is not something we call, the shop page having no menu, all four
faults offered, each one reaching `POST /api/switches/<target>` with the right state,
the repeated payment offered on Stripe and nowhere else, the malformed orders offered
on the mail they arrive as, and the endpoint's answer appearing on the tile that
fired it.

`OrderForm.test.tsx` covers the untouched press going to the plain endpoint, the
panel staying shut until it is asked for, the catalogue being fetched only then, a
chosen basket sent with no address at all, an address sent when one was typed, an
empty basket refused with a reason, and the caller being told whether to expect a
mail.

On the server, `orders.controller.test.ts` covers an order with an address, without
one and with a blank one, and `completion.service.test.ts` covers rule 6.7 asking
about `confirmTo` and not about `customerEmail`. The whole suite stays green.
