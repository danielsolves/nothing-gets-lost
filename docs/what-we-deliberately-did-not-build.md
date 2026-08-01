# What I deliberately did not build

This page lists the things that are missing from this demo on purpose, each with the reason, and it is for the visitor who noticed a gap and wants to know whether it was a decision or an oversight.

Every item below was considered and refused. Where a refusal cost something, that cost is stated rather than argued away.

## Connecting your own database

This is the feature that demos best and is the worst idea in the set.

It would mean asking a stranger to type credentials for their production database into a public form on a site they found in a proposal. No serious client does that, and the one who did would be a liability: I would be holding live database credentials for a company I have no contract with, in a container on a server I run for demos.

The read only SQL console does the same job from the other direction. The visitor queries **my** database instead of me querying theirs, and it is locked down accordingly: a separate role with `default_transaction_read_only = on` and a two second `statement_timeout`, `GRANT SELECT` on exactly four views and nothing else, a single statement that must begin with `SELECT`, an enforced row limit, and a per IP cap. See `packages/db/migrations/005_readonly_role.sql`.

The point of the original idea was "see your own data move". The console delivers "check my claims against the actual rows" instead, which is the part that was ever worth anything.

## Real WhatsApp

WhatsApp Business needs Meta business verification and template approval before you can send anything to anyone. A visitor cannot do that in passing, which removes the entire reason to build it: the value of a messaging channel here is that the message lands on the visitor's own phone, in their own account.

The Twilio sandbox would work technically. It is a lot of setup and moving parts for the weakest of the three notification channels, and Slack already provides the same proof with an OAuth flow the visitor completes in about fifteen seconds. So Slack it is.

## A shared demo login to my HubSpot portal

The obvious way to let a visitor see the HubSpot side is to put a demo account and password in the README.

Credentials in a README read like a leaked secret. Anybody skimming the repository sees a username and a password sitting in a file and forms an opinion in a second, and on a project whose entire subject is care with other people's systems that is the most expensive possible first impression. It does not matter that the account would be a throwaway in a sandbox portal. The reader does not stop to check.

Instead there are two things:

- A **Connect your own HubSpot** button. OAuth, scoped to `crm.objects.contacts.read` and `crm.objects.contacts.write` and nothing else, token encrypted at rest with a 24 hour lifetime and a disconnect button. The contact is created in the visitor's portal, and they check it with their own login. A test portal is recommended under the button; a production portal is not needed.
- A read back button against **my** portal, which is labelled in the interface as an indication and not as proof, because I render that answer and a skeptic is right not to trust it.

Nobody has to connect anything. The proof chain, the Stripe receipt, the confirmation mail in your own inbox, your own webhook endpoint and the downloadable proof log all work with no connection at all.

## No login

There is no account, no sign up and no password on this demo. Adding one would put a form between a visitor and the thing they came to see, and the success criterion for this project is that somebody understands the page in twenty five seconds and breaks something on purpose within sixty.

The cost is real and it is accepted: the demo is open to the internet, so it is rate limited instead. Model calls are capped per hour and per IP with recorded answers taking over afterwards, order placement is capped per hour and per IP, and SQL queries are capped the same way. Rate limits are the right tool here. A login is not.

## No settings page

Everything configurable is either a state you can put a system into from the menu on its own tile in the diagram or an environment variable in `.env.example`. There is no preferences screen, no theming, no persisted per visitor state.

A settings page on a demo is a place to hide decisions. If a knob matters it belongs on the thing it acts on, where a visitor will actually turn it, and if it does not matter it should not exist. The controls used to sit in a drawer at the foot of the page called "Control panel", which was a settings page by another name and is gone for this reason.

## No second scenario

One scenario: order, payment, CRM, invoice, notification, confirmation mail. That scenario was chosen because it is the one that appears most often in the job postings this project was built to answer, not because it was the easiest to build.

A second scenario would double the surface area and add nothing to the argument. The claim being made is not "I have built many integrations", it is "here is what a correct one is made of, check it yourself". One scenario, examined properly, makes that case. Two, examined half way, makes it worse.

## No multi tenancy

There is one world, not one per visitor. If somebody else is experimenting while you are on the page, you see their traffic, and a line at the top of the page tells you so (detected from the number of open SSE connections). Switches reset automatically after ten minutes without a click.

This is the refusal that costs the most and it is still the right one. A per visitor sandbox would mean the switches were not really switching anything: each visitor would get a private simulation, and a demo about reliability would be a stage set at precisely the point where it claims not to be. When you cut HubSpot here, the connection is really cut, for everyone, until somebody restores it. That is the whole reason to believe the queue behaviour on screen.

## No Redis, no Kubernetes manifests, no queue library

The queue is written by hand against Postgres, with `SELECT ... FOR UPDATE SKIP LOCKED`, because the queue is the part a visitor is supposed to be able to read. That argument, including the case for **not** doing it this way in a real project under real load, has its own page: [why no queue library](why-no-queue-library.md).

Kubernetes manifests are absent for a duller reason. This is seven services and one `docker compose up`. Anything more would be scaffolding for an audience that is not reading this repository.

## Not production ready, and not claiming to be

Stripe runs in test mode only, and the mediator refuses to start on a key that does not begin with `sk_test_`. Retry delays are compressed to fit a visitor's attention span (2s, 8s, 30s, 2min, 10min) where production would start at 30 seconds and stretch over hours. Email addresses and OAuth tokens are deleted after 24 hours. There is no HA setup, no backup story, no alerting.

None of that is what the demo is trying to prove. It is trying to prove one specific thing, and the things it does not do are listed here rather than left for you to find.
