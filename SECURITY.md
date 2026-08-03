# Security

This is a public demo, and it is deliberately breakable from the outside: anyone can
place an order, cut a line to one of the five systems and watch what happens. That is
the point of it, not a finding.

What is not intended, and what this file is for, is anything that reaches past the
demo: reading data belonging to somebody else, escaping a container, reaching the
host, sending mail that did not come from a visitor's own order, or getting the
machine to make a request it was never asked to make.

## Reporting

**Use GitHub's private advisory form:**
[Report a vulnerability](https://github.com/danielsolves/nothing-gets-lost/security/advisories/new)

It reaches me privately, and it keeps the details out of a public issue until there is
something to say about them.

If GitHub is not an option, `daniel@danielsolves.ai` works. Do not open a public issue
for something exploitable.

## What to expect

One person maintains this, so the honest answer is days rather than hours:

| | |
|---|---|
| Acknowledged | within three working days |
| First assessment | within a week |
| Fix or a stated reason not to | depends on what it is, and you will hear which |

There is no bounty. There is credit in the advisory and in the commit, if you want it.

## Already known, and on purpose

Some things look like findings and are not:

- **The switches.** Cutting a system's line, making it slow, or breaking it on purpose
  is a feature of the demo, available to every visitor.
- **`STRIPE_WEBHOOK_SECRET` is empty on the server.** The verifier refuses every
  webhook when the secret is empty. That is the closed state, not the open one: with
  some arbitrary placeholder it would compute a HMAC against that placeholder and
  accept forgeries.
- **No login.** There are no accounts, so there is nothing to authenticate. Orders are
  visible to everyone by design, which is why the demo never asks for anything real.
- **Development dependency advisories.** The tooling advisories Dependabot reports
  against vite, vitest and esbuild need somebody to be running a development server.
  Nothing in a published image runs one.

## What is worth looking at

If you want somewhere to start: the egress gate is the only path out to the five
outside systems, the MCP server exposes four read-only tools over a public endpoint,
and the mailer sends real mail to an address a stranger typed into a form.
