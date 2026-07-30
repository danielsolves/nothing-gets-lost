# The diagram becomes the demo

Date: 31 July 2026
Status: approved in conversation, built in the same session

## Why

Specification section 2 asks for a diagram of the connected systems with dots running
between them, boxes lighting up in turn, and a control panel whose loudest switch is an
invitation. What was built is a static list of five boxes with no connectors and no
motion, and the switches live in a collapsed tab at the bottom of the page.

The success criterion in section 1 is that a stranger breaks something on purpose
within sixty seconds. Today that costs a scroll past everything and a click into a
drawer labelled "Control panel". The distance between the claim and the action is the
problem this redesign removes.

## What changes

**The diagram is the interface.** The mediator sits in the middle, the five targets
around it, real connectors between them. Clicking a target cuts its line; clicking it
again restores it. The box and its connector carry the state, so the consequence of the
click is visible where the click happened.

**The five-step walkthrough goes away.** Decided by the owner. In its place, one
prominent starting action and a diagram that explains itself. This is a deliberate
departure from spec section 2, which scripts five steps. The reasoning: two things
telling a visitor what to do is worse than one thing that is obvious. The risk it takes
on is that a non-developer does not know where to start, which is why the starting
action stays loud and a single hint line survives beneath it.

**Dots are driven by real deliveries, never by a timer.** Section 7 forbids stage
props at the point of proof, and a CSS loop that animates whether or not anything
happened would be exactly that. A dot exists because a delivery changed state:

| Transition | What the dot does |
|---|---|
| into `done` | travels out and lands |
| into `pending` after a failed attempt | travels out and comes back |
| into `dead` | travels out and stops short |

**The header stops contradicting itself.** It currently reads `● LIVE` immediately
followed by "Recorded operation. No model key is configured." That sentence is about
the free-text reading step alone, but it is the second thing a visitor reads and it
sounds like the whole demo is a recording. The live badge keeps the top; the recorded
note moves to the reading step it describes.

## Structure

| Unit | Job | Depends on |
|---|---|---|
| `Diagram` | lay out the nodes and connectors, own the cut action | `switches`, `deliveries` |
| `pulses.ts` | turn two snapshots of the delivery list into travelling dots | nothing |
| `useDeliveryPulses` | hold pulses for their lifetime, drop them after | `pulses.ts` |
| `Stage` | header, starting action, hint | nothing |

`pulses.ts` is a pure function over the previous and current delivery arrays, so the
rule that decides when a dot exists is testable without a browser, a clock or a stream.

Nothing on the server changes. `Diagram` already receives `switches` and `deliveries`,
and the stream already carries every delivery state change, so this is a rendering
change from end to end.

## On a phone

A node-and-edge layout is the hardest thing to keep legible on a narrow screen, and the
specification says the typical visitor may arrive from one. Below the breakpoint the
layout collapses to a single column: the mediator on top, the targets stacked under it,
connectors becoming short vertical stubs that the dots travel down. No horizontal
scrolling, no pan-and-zoom, no second layout to maintain.

## What stays

The control panel keeps all four states per target, the three chaos buttons and the
reset. The diagram offers only cut and restore, because that is the one dramatic action
a first-time visitor needs. Full range in the drawer, the loud action on the page.

The counters, the log, the proof panel, the SQL console and the connection buttons are
untouched. With the walkthrough gone, the form for the visitor's own order is no longer
locked behind finishing it.

## Testing

Pure logic first: `pulses.ts` gets tests for each transition, for a delivery that did
not change, for a first render with no previous snapshot, and for several deliveries
changing at once. `Diagram` gets tests for the cut action calling the right endpoint,
for restore, for state reaching the connector, and for keyboard reachability. The
existing suite has to stay green throughout.
