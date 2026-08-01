# What I deliberately did not build

This page lists the things that are missing from this demo on purpose, each with the reason, and it is for the visitor who noticed a gap and wants to know whether it was a decision or an oversight.

Every item below was considered and refused. Two of them were built first and taken out again, and they are on this page rather than in a history file because the decision is the part worth reading: somebody about to build the same thing needs the reason, not the date. Where a refusal cost something, that cost is stated rather than argued away.

## Connecting your own database

This is the feature that demos best and is the worst idea in the set.

It would mean asking a stranger to type credentials for their production database into a public form on a site they found in a proposal. No serious client does that, and the one who did would be a liability: I would be holding live database credentials for a company I have no contract with, in a container on a server I run for demos.

The point of the original idea was "see your own data move". What delivers that without anybody handing over a secret is the visitor's own endpoint: a url they paste, every delivery posted to it on the same retry schedule the five systems get, watched from their side. A record landing in a system I do not control is the whole of what the connected database was for, and it costs a url instead of a credential.

For a while the counter-offer was the other direction as well, a read only SQL console against my database. That is the next section.

## A public SQL console

There was a console on the page, under the heading "Do not trust my screen. Ask the database yourself", and it let a visitor run one guarded `SELECT` against a read only role. It was careful work: `default_transaction_read_only = on`, a two second `statement_timeout`, `GRANT SELECT` on views and no table, a single statement that had to begin with `SELECT`, an enforced row limit and a per IP cap.

The heading is what took it out. What the console then handed over was my database, through my views, with my masking, which invites a reader to check my screen against my own data and calls the answer independent. It is the same class of evidence as the MCP server, just a different door, and the difference between the two is what the door claims. The MCP server is a way to read the backlog without going through the page, which is a convenience and is offered as one. The console was sold as the end of having to trust me, and no query it could run was ever that.

The role stays and did not need changing. `ngl_ro` from migration `005` is exactly as it was and now has exactly one user, the MCP server, which is handed that url and no other credential at all. What is checkable without me is what always was: the receipt on stripe.com, the confirmation mail with a `Received` header stamped by the visitor's own provider, and every delivery arriving at an endpoint of theirs.

## Real WhatsApp

WhatsApp Business needs Meta business verification and template approval before you can send anything to anyone. A visitor cannot do that in passing, which removes the reason it was attractive: a message landing on their own phone, in their own account.

The Twilio sandbox would work technically. It is a lot of setup and moving parts for the weakest of the three notification channels, and the demo already has one of those, into the workspace this project owns, which is enough to show a notification being retried and delivered exactly once. Where something has to arrive somewhere I do not control, the confirmation mail and the visitor's own endpoint do it without a verification queue in front of them.

## Connecting your own Slack or your own HubSpot

This one was built, sat on the page for a while, and came out.

A visitor could connect their own Slack workspace and their own HubSpot portal through OAuth, and deliveries then went there instead of into the house accounts. It reads well in a feature list and it was the wrong thing to have built. A stranger does not hand a portfolio page OAuth with write access to their CRM, and none did. On the other side of that nobody stood an encrypted store of other people's access tokens, a data protection surface, an abuse surface, and a branch between house and visitor at three points in the delivery path.

It was also broken, which is worth writing down rather than tidying away. The app asked for `crm.objects.contacts.read` and `crm.objects.contacts.write`, because the sentence in my head was "create a contact". The delivery goes on to create a deal, associate it with the contact and write line items, so a visitor's token was refused at the deal step with a 403, retried six times and parked. The scope list was wrong about my own code, and nobody was connecting, so it stayed quiet.

What does the same job at a fraction of the hurdle is the visitor's own endpoint: a url, no login, no scopes, every delivery posted to it with the same retry schedule and the retries visible from their side. The property that made connecting worth building is that a record lands in a system I do not control, and that survives intact. What does not survive is me holding a credential of theirs.

`services/api/src/oauth/`, the `TokenStore`, the visitor branch in the mediator and the Slack send log behind it are gone from the tree, and migration `015_drop_visitor_oauth.sql` drops the two tables. Dropped rather than emptied: a table shaped to hold other people's access tokens, standing in a database with nothing left to write to it, is a thing somebody fills in again one day without reading any of this.

## A shared demo login to my HubSpot portal

The obvious way to let a visitor see the HubSpot side is to put a demo account and password in the README.

Credentials in a README read like a leaked secret. Anybody skimming the repository sees a username and a password sitting in a file and forms an opinion in a second, and on a project whose entire subject is care with other people's systems that is the most expensive possible first impression. It does not matter that the account would be a throwaway in a sandbox portal. The reader does not stop to check.

Instead there is a read back button against **my** portal, which asks HubSpot for the record now and shows what came back. It is labelled in the interface as an indication and not as proof, because I render that answer and a skeptic is right not to trust it.

That leaves the CRM as the one step in the chain a visitor cannot verify, and the honest answer is to say so and put the weight elsewhere. The Stripe receipt is served by stripe.com, the confirmation mail carries a `Received` header their own provider stamped, and every delivery reaches an endpoint of theirs if they give one. Letting a visitor into a portal of mine was never going to be worth more than those three, and connecting a portal of theirs turned out to be worth less, which is the section above.

## No login

There is no account, no sign up and no password on this demo. Adding one would put a form between a visitor and the thing they came to see, and the success criterion for this project is that somebody understands the page in twenty five seconds and breaks something on purpose within sixty.

The cost is real and it is accepted: the demo is open to the internet, so it is rate limited instead. Order placement is capped per hour and per visitor, and the address that identifies a visitor is hashed rather than kept, because a demo that lectures about care with other people's data while keeping a list of IPs would be arguing against itself. Rate limits are the right tool here. A login is not.

An order that asks for a confirmation mail is capped twice more, and tightly: once against the visitor and once against the address the mail would go to. Everything else this demo does lands in an account I own, and the worst a stranger can manage with thirty orders an hour is to make my own CRM untidy. A confirmation mail goes wherever the visitor types, which makes the form a way of sending mail from this domain to people who did not ask for it. What that costs is not money but whether mail from the domain is delivered anywhere at all, and that is lost slowly and won back with difficulty. The button that starts the demo asks for no address, can send to nobody, and is charged against neither cap.

## No captcha

A proof of work challenge is solvable by any bot willing to spend the cycles, because spending cycles is the whole mechanism; there is nothing in it to defeat. It also charges an old phone considerably more than it charges a rented server, so it taxes the visitor this page exists for and waves through the one it does not. The challenges built on behaviour and device signals are broken commercially for a few cents a thousand.

Neither kind stops somebody who has decided to abuse this form. What such a person needs is volume, and volume is precisely what the caps above refuse. Putting a puzzle in front of the one interaction the whole page is built around, in exchange for nothing, was the worse trade.

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

Stripe runs in test mode only, and the mediator refuses to start on a key that does not begin with `sk_test_`. Retry delays are compressed to fit a visitor's attention span (2s, 8s, 30s, 2min, 10min) where production would start at 30 seconds and stretch over hours. Email addresses are deleted after 24 hours, in all three places they are written. There is no HA setup, no backup story, no alerting.

None of that is what the demo is trying to prove. It is trying to prove one specific thing, and the things it does not do are listed here rather than left for you to find.
