# Deploy runbook

How `nothing-gets-lost` gets from a merge on `main` to https://ngl.danielsolves.ai.

There is no staging. Anything that goes live is immediately public, so the gate is a
human approval on a GitHub environment rather than a branch protection rule. A merge
on its own changes nothing a visitor can see.

## Contents

1. [The shape of it](#1-the-shape-of-it)
2. [The deploy keypair](#2-the-deploy-keypair)
3. [The authorized_keys line](#3-the-authorized_keys-line)
4. [What a stolen key can and cannot do](#4-what-a-stolen-key-can-and-cannot-do)
5. [Why "unprivileged user in the docker group" is not the answer](#5-why-unprivileged-user-in-the-docker-group-is-not-the-answer)
6. [The known_hosts entry](#6-the-known_hosts-entry)
7. [Setting up the production environment in GitHub](#7-setting-up-the-production-environment-in-github)
8. [One-time: turn /opt/nothing-gets-lost from an rsync target into a git clone](#8-one-time-turn-optnothing-gets-lost-from-an-rsync-target-into-a-git-clone)
9. [Installing ngl-deploy](#9-installing-ngl-deploy)
10. [Day to day](#10-day-to-day)
11. [When it fails](#11-when-it-fails)
12. [What is deliberately not here](#12-what-is-deliberately-not-here)

---

## 1. The shape of it

```
push to main
   |
   v
CI workflow (test, soak, stack)          .github/workflows/ci.yml
   |  conclusion == success
   v
Deploy workflow                          .github/workflows/deploy.yml
   |  parks on environment "production"
   |  waits for a required reviewer
   v
one ssh call, no arguments that matter
   |
   v
/usr/local/bin/ngl-deploy on the host    tools/deploy/ngl-deploy
   git pull --ff-only
   docker compose build (9 services, one at a time, migrate included)
   docker compose up -d --wait
   compare schema_migrations against packages/db/migrations
```

Deploy is chained to CI with `workflow_run` rather than by adding a job to
`ci.yml`. `ci.yml` also runs on `pull_request`, including from forks, so a deploy
job living there would need an `if:` guard on every run and would still appear as a
skipped job on every pull request. `workflow_run` gates on the conclusion of the CI
workflow as a whole, which means the `stack` job counts without `deploy.yml` naming
it, and a fourth CI job added later is covered automatically.

Two consequences of `workflow_run` to keep in mind:

* It only fires for a copy of `deploy.yml` that is on the default branch, and the
  run always uses the default branch copy. Editing this workflow on a topic branch
  has no effect until it is merged.
* `ngl-deploy` always fast-forwards to the current tip of `origin/main`. If two
  merges land in quick succession, the first approval may already deploy the second
  commit. The `concurrency` group keeps the runs from overlapping, but it does not
  pin a run to a commit. The commit that actually went live is printed in the job
  log by `ngl-deploy` on its last line.

## 2. The deploy keypair

This is an SSH key for the demo host. It is not a GitHub deploy key and it grants
no GitHub access at all. The repository is public, so the server clones and pulls
over HTTPS and needs no GitHub credential of any kind.

Generate it on your laptop:

```bash
ssh-keygen -t ed25519 -a 100 -N '' -C 'github-deploy' -f ./ngl-github-deploy
```

No passphrase, because GitHub Actions cannot type one. The restriction in
`authorized_keys` is what makes that acceptable, not the absence of a passphrase.

Where each half goes:

| half | file | destination |
| --- | --- | --- |
| private | `ngl-github-deploy` | GitHub, environment secret `DEPLOY_KEY` on `production`. Paste the whole file including the `-----BEGIN` and `-----END` lines and the trailing newline. |
| public | `ngl-github-deploy.pub` | the server, appended to `/home/deploy/.ssh/authorized_keys` with the restriction prefix from section 3. |

Then remove both local copies:

```bash
rm -f ./ngl-github-deploy ./ngl-github-deploy.pub
```

If you ever need to rotate: generate a new pair, add the new line to
`authorized_keys`, update the secret, run the workflow manually once, then delete
the old line. In that order, so there is never a window with no working key.

## 3. The authorized_keys line

In `/home/deploy/.ssh/authorized_keys`, one line, no line breaks:

```
command="/usr/local/bin/ngl-deploy",no-agent-forwarding,no-port-forwarding,no-pty,no-X11-forwarding,no-user-rc ssh-ed25519 AAAA... github-deploy
```

Replace `AAAA...` with the base64 body from `ngl-github-deploy.pub`. Keep the
`github-deploy` comment at the end: it is how you will recognise the line in a year.

File permissions, which sshd enforces:

```bash
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
```

Verify the restriction took effect before you trust it. From your laptop, using the
private half before you delete it:

```bash
ssh -i ./ngl-github-deploy deploy@<host> 'cat /opt/nothing-gets-lost/.env'
```

The correct outcome is that `ngl-deploy` runs a deployment and the `.env` is never
printed. `ngl-deploy` echoes one audit line showing the command that was requested
and ignored. If you see the contents of `.env`, the `command=` prefix is not in
place and you must stop and fix it.

## 4. What a stolen key can and cannot do

Assume the private half leaks out of GitHub.

**It can** cause a deployment. That means it can force the host to fast-forward to
whatever is currently on `origin/main`, rebuild the images and restart the stack.
Repeatedly, which is a denial of service: nine image builds on a memory tight box.
It can read the output of `ngl-deploy`, which is commit hashes, commit subjects,
migration filenames and container status. Nothing in that output is a credential.

The real reach of the key is therefore bounded by who can push to `main`. If an
attacker holds both this key and write access to the repository, they have the
machine. The key is not the last line of defence there; the repository is.

**It cannot:**

* get a shell. `command=` replaces whatever the client asks for, and `no-pty`
  refuses a terminal even if something did break out.
* open a tunnel. `no-port-forwarding` blocks `-L`, `-R` and `-D`, so the key cannot
  reach Postgres on `127.0.0.1:5432` or any service on the private compose network,
  none of which are published to the internet.
* hop onward using your agent. `no-agent-forwarding` blocks it.
* `cat .env`. The requested command never runs. Same for `scp`, `sftp` and `rsync`:
  those all work by asking the far side to run a program, and `command=` overrides
  the request, including subsystem requests.
* run `docker`. Which matters, see the next section.
* execute `~/.ssh/rc`, thanks to `no-user-rc`.

**Maintenance rule that follows from this:** `ngl-deploy` must never read
`SSH_ORIGINAL_COMMAND` for anything except logging, and must never `eval` it. That
variable holds attacker-controlled text. Passing it to a shell would hand back
everything the `command=` restriction just took away. The script prints it with
`%q` and otherwise ignores it. Adding "just a flag for a dry run" is how this
protection gets undone, so if you need a variant, add a second key with a second
`command=` pointing at a second script.

## 5. Why "unprivileged user in the docker group" is not the answer

The `deploy` account is in the `docker` group. That group is root. Not "close to
root": root. Anyone who can talk to the Docker socket can do this:

```bash
docker run --rm -v /:/host -it alpine chroot /host sh
```

and is now root on the host, with the real filesystem mounted. They can also
`docker cp` the `.env` straight out of the `api` container, or start a container
with `--pid=host --privileged`. There is no configuration of the `docker` group
that prevents this, because handing out the socket is the same as handing out root.

So the separation in this setup does not come from the `deploy` account being
unprivileged. It comes from one place only: `command="/usr/local/bin/ngl-deploy"`
means the key can never invoke `docker` at all. It cannot invoke anything. The
account's privileges are irrelevant because the key cannot express a request that
would use them.

Practical consequences:

* Never add a second `authorized_keys` entry for this key without a `command=`
  prefix. One unrestricted entry cancels every guarantee in section 4.
* The `deploy` account must have no usable password: `passwd --lock deploy`.
* It still needs a real shell (`/bin/bash`), because sshd runs the `command=`
  through the account's login shell. Setting `nologin` breaks the deploy.
* Do not treat the `deploy` account as a sandbox in any other context. If you want
  an actual privilege boundary around Docker, that is rootless Docker or a
  filtering socket proxy, and it is a different piece of work than this runbook.

## 6. The known_hosts entry

Do not take the host key from `ssh-keyscan` on your laptop and trust it. Read it on
the server itself, over a session you already trust.

On the server:

```bash
sed "s|^|ngl.danielsolves.ai |" /etc/ssh/ssh_host_ed25519_key.pub
```

Substitute the hostname that GitHub will actually connect to, which is whatever you
put in the `DEPLOY_HOST` variable. If SSH is not on port 22, the format is
`[ngl.danielsolves.ai]:2222 ssh-ed25519 AAAA...` with the brackets.

Copy the resulting single line into the GitHub environment secret
`SSH_KNOWN_HOSTS`. The workflow writes it to `~/.ssh/known_hosts` and runs with
`StrictHostKeyChecking=yes`, so a changed or spoofed host key aborts the deploy
instead of asking a question nobody is there to answer.

A host key is not itself a secret. It is stored as a secret only so that the whole
SSH configuration sits in one place with one access rule.

## 7. Setting up the production environment in GitHub

In the repository, `Settings` > `Environments` > `New environment`. Name it exactly
`production`, because that is the name in `deploy.yml`.

Then, on that environment's page:

1. **Deployment protection rules** > tick **Required reviewers** > add yourself >
   **Save protection rules**. GitHub permits self-approval on environments, unlike
   pull request reviews, so a single-person account works.
2. Optionally set **Wait timer** to 0 and leave **Allow administrators to bypass**
   unticked. Bypass is the one setting that would quietly defeat the whole gate.
3. **Deployment branches and tags** > **Selected branches and tags** > add a rule
   for `main`. Belt and braces alongside the `if:` in the workflow.
4. **Environment secrets** > **Add secret**, twice:
   * `DEPLOY_KEY`, the private half from section 2.
   * `SSH_KNOWN_HOSTS`, the line from section 6.
5. **Environment variables** > **Add variable**:
   * `DEPLOY_HOST`, the hostname or address GitHub connects to.
   * `DEPLOY_USER`, `deploy`.
   * `DEPLOY_PORT`, only if SSH is not on 22.

Put the secrets on the **environment**, not on the repository. Repository secrets
are readable by any job in any workflow, including one added in a pull request.
Environment secrets are only handed to a job that names that environment, which
means only after a reviewer has approved. That is the difference between a gate and
a suggestion.

After a merge to main you will see the Deploy run appear with a **Review
deployments** button. Nothing has touched the server until you press it.

## 8. One-time: turn /opt/nothing-gets-lost from an rsync target into a git clone

Today `/opt/nothing-gets-lost` is an rsync target. `ngl-deploy` refuses to run
against it and says so. This section converts it.

### Read this before you start

`docker-compose.yml` sets `name: nothing-gets-lost` at the top level. The compose
project name is therefore fixed in the file and **does not** come from the directory
name. That has one very sharp consequence:

> Running `docker compose` in the new directory controls the **same containers and
> the same `nothing-gets-lost_pgdata` volume** as the old directory. The two
> directories are not two environments. They are two views of one running stack.

Good news: the swap needs no data migration. Bad news: `docker compose down -v` in
the new directory destroys the live database. Do not type `-v` anywhere in this
section.

### Checklist

Run everything as root unless a step says otherwise. Steps 1 to 6 change nothing
that is running, and you can stop after any of them.

**1. Back up the database. First, before anything else.**

Pick a backup directory first. It has to be owned by root, readable by nobody else,
and outside the deployment directory so that no `docker compose` or git operation
in section 8 can reach it. Which directory that is stays out of this file: the
repository is public, and steps 1 and 2 write a full database dump and a copy of
every production credential, so printing where they land would save an intruder the
one part of the job that takes effort.

```bash
BACKUP_DIR=...                      # set this to the directory you chose
install -d -m 700 -o root -g root "$BACKUP_DIR"

cd /opt/nothing-gets-lost
docker compose exec -T db pg_dump -U ngl -d ngl \
  | gzip > "$BACKUP_DIR/ngl-db-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
ls -lh "$BACKUP_DIR"
```

The first `ngl-deploy` will apply any migration that is on disk but not yet in
`schema_migrations`. Have the backup.

**2. Back up the live .env, root only.**

```bash
install -m 600 /opt/nothing-gets-lost/.env \
  "$BACKUP_DIR/ngl-env-$(date -u +%Y%m%dT%H%M%SZ).bak"
```

This file holds the real Stripe, HubSpot and Slack tokens, the real database and
read-only passwords, and ports that differ from any local `.env`. It is the one
irreplaceable thing on the box. It is gitignored, so no git operation will ever
touch it, and nothing in this checklist overwrites it.

**3. Record what is running now, so you can tell later whether it changed.**

```bash
cd /opt/nothing-gets-lost
docker compose ps --all > /root/ngl-before-ps.txt
docker compose images > /root/ngl-before-images.txt
cat /root/ngl-before-ps.txt
```

**4. Create the deploy account, if it does not exist yet.**

```bash
adduser --disabled-password --gecos '' deploy
usermod -aG docker deploy
passwd --lock deploy
sudo -u deploy docker ps >/dev/null && echo 'deploy can reach the docker socket'
```

**5. Clone into a new directory next to the old one.**

Over HTTPS, as the `deploy` user so that ownership is right from the start and git
does not later complain about a dubious directory owner.

```bash
sudo -u deploy git clone https://github.com/danielsolves/nothing-gets-lost.git \
  /opt/nothing-gets-lost.new
cd /opt/nothing-gets-lost.new
sudo -u deploy git status
sudo -u deploy git log --oneline -5
```

**6. Copy the live .env across and prove it arrived intact.**

```bash
cp -a /opt/nothing-gets-lost/.env /opt/nothing-gets-lost.new/.env
chown deploy:deploy /opt/nothing-gets-lost.new/.env
chmod 600 /opt/nothing-gets-lost.new/.env
cmp /opt/nothing-gets-lost/.env /opt/nothing-gets-lost.new/.env && echo 'env identical'
```

`cmp` printing nothing plus `env identical` is the pass. Confirm git ignores it:

```bash
cd /opt/nothing-gets-lost.new
sudo -u deploy git check-ignore -v .env      # must print .gitignore:3:.env  .env
sudo -u deploy git status --porcelain        # must print nothing at all
```

**7. Find out what the old directory has that git does not.**

This is the step that catches hand-edits made on the box over the months. Do not
skip it, it is the whole reason for doing the swap in two stages.

```bash
diff -r -q \
  --exclude=.git --exclude=node_modules --exclude=.env --exclude=dist \
  /opt/nothing-gets-lost /opt/nothing-gets-lost.new
```

Expect a handful of "Only in" lines for build artefacts. Any *differing* tracked
file is a change that exists only on the server. Decide for each one: either it
belongs in git and you commit it and re-pull, or it was a mistake and it goes.
Do not carry it across by hand, because the next `git pull --ff-only` will not know
about it and the difference will come back.

Validate the compose file in the new directory. `config --quiet` parses and
interpolates and starts nothing:

```bash
cd /opt/nothing-gets-lost.new
sudo -u deploy docker compose config --quiet && echo 'compose config valid'
```

**8. Swap. This is the first step that changes anything.**

Nothing is stopped here. The containers keep running throughout; only the
directory that describes them moves.

```bash
mv /opt/nothing-gets-lost      /opt/nothing-gets-lost.rsync-old
mv /opt/nothing-gets-lost.new  /opt/nothing-gets-lost
chown -R deploy:deploy /opt/nothing-gets-lost
ls -ld /opt/nothing-gets-lost /opt/nothing-gets-lost.rsync-old
```

Keep `.rsync-old` for at least a week. It costs disk and it is your way back.

**9. First run, by hand, from your own root shell.**

Not through the key, not through GitHub. Install `ngl-deploy` first (section 9),
then:

```bash
sudo -u deploy /usr/local/bin/ngl-deploy
```

Watch it pull, build all nine services, wait for health, and print the migration
comparison. The last line is `ngl-deploy: OK, <sha> is live`.

**10. Check the site with your eyes.**

```bash
curl --fail --silent --show-error -o /dev/null -w '%{http_code}\n' https://ngl.danielsolves.ai/
curl --fail --silent --show-error https://ngl.danielsolves.ai/api/state | head -c 200; echo
```

Then load the page in a browser. `200` is not the same as correct.

**11. Only now, wire up GitHub.** Sections 2, 3, 6 and 7, then trigger the workflow
manually once with `workflow_dispatch` and approve it. A deploy that changes nothing
is the right first deploy.

### Rolling back the swap

If step 9 or 10 goes badly, you are one `mv` away from where you started. The
containers, images and the database volume are untouched by the swap itself.

```bash
mv /opt/nothing-gets-lost      /opt/nothing-gets-lost.git-failed
mv /opt/nothing-gets-lost.rsync-old /opt/nothing-gets-lost
cd /opt/nothing-gets-lost
docker compose up -d --wait          # note: no -v, ever
docker compose ps --all
diff /root/ngl-before-ps.txt <(docker compose ps --all)
```

That returns the directory. It does **not** undo a migration that already ran, and
it does not undo an image rebuild. If the database moved and you need it back, stop
the stack (`docker compose stop`, not `down`), restore from the dump you took in
step 1 into a fresh database, and treat that as its own incident rather than part
of this checklist.

If the `.env` is what went wrong, the copy from step 2 is in the backup directory you
chose in step 1.

## 9. Installing ngl-deploy

The script lives in git at `tools/deploy/ngl-deploy` and runs from
`/usr/local/bin/ngl-deploy`. It is copied, not symlinked into the checkout: the
whole point is that a script the deploy key can run is not a file the deploy
process rewrites.

```bash
install -o root -g root -m 755 \
  /opt/nothing-gets-lost/tools/deploy/ngl-deploy \
  /usr/local/bin/ngl-deploy
ls -l /usr/local/bin/ngl-deploy      # -rwxr-xr-x root root
```

Root owned and not writable by `deploy` is tidiness rather than security, since
`deploy` is in the `docker` group and could rewrite it through a container anyway.
It does stop an accident.

When you change the script in git, re-run that `install` command by hand. It is
deliberately not automatic, because a deploy that updates its own deployer cannot
be reasoned about when it half fails.

Check the dependencies it needs are present:

```bash
command -v git docker flock comm sed
docker compose version
```

## 10. Day to day

* Merge to `main`. CI runs. If CI is green, a Deploy run appears and waits.
* Approve it in the GitHub UI when you are ready to have it public.
* To redeploy the current `main` without a new commit, use **Run workflow** on the
  Deploy workflow. It still requires approval.
* To deploy from the host with no GitHub involvement:
  `sudo -u deploy /usr/local/bin/ngl-deploy`.

Housekeeping, roughly monthly, by hand:

```bash
docker image prune -f            # dangling layers from nine rebuilds per deploy
df -h /var/lib/docker
free -m
```

Nine images are rebuilt on every deploy on a memory and disk constrained box.
Dangling layers are the thing most likely to fill the disk. `prune -f` without
`-a` only removes untagged layers and leaves every image in use alone.

## 11. When it fails

**"is not a git clone"** or **".env is missing"**: `ngl-deploy` stopped before
touching anything. Section 8 has not been completed, or the swap put the wrong
directory in place. Nothing is broken, fix the premise.

**"refusing to deploy over uncommitted changes"**: someone edited a tracked file on
the server. The listed files are printed. Decide whether the change belongs in git,
then either commit it upstream and re-run, or `git checkout --` it away. Do not use
`git reset --hard` reflexively; read what the change is first.

**"docker-compose.yml no longer matches the build list"**: a service was added to or
removed from compose and the explicit list in `/usr/local/bin/ngl-deploy` was not
updated. This is the guard doing its job. Update `BUILD_SERVICES` and
`EXPECTED_SERVICES` in git, re-run the `install` from section 9, deploy again.

**`up --wait` times out**: one service never became healthy.

```bash
cd /opt/nothing-gets-lost
docker compose ps --all
docker compose logs --tail 100 <service>
```

One known false alarm: `ledger` reports unhealthy on purpose while a visitor has it
switched off, and `mediator` waits for `ledger` to be healthy. A deploy recreates
the container, so it normally comes up with its socket open, but a visitor toggling
it off during the health window can fail the deploy for a reason that is not a
fault. Re-run the deploy.

**"schema_migrations does not match packages/db/migrations"**: the important one.
The script lists exactly which files are on disk but not applied. The usual cause is
a `migrate` image that was not rebuilt, because `packages/db/Dockerfile` does
`COPY packages ./packages`, so the `.sql` files are baked into the image. A `git
pull` alone only puts them on the host disk, and the migrator inside a stale image
correctly reports that it has nothing new and exits 0. A green `migrate` is a
statement about the image, not about the database.

```bash
cd /opt/nothing-gets-lost
docker compose logs migrate                       # from your shell, not from the key
docker compose build migrate
docker compose up -d --wait
```

Then run `ngl-deploy` again so the comparison is made properly rather than by eye.

`ngl-deploy` does not print container logs itself, on purpose. Logs from a failed
boot can contain connection strings and other fragments of `.env`, and this script's
stdout goes into a GitHub Actions log. Reading logs is a thing you do over your own
SSH session.

**A deploy that half succeeded**: the stack is up on the new images and the schema
check failed. The site is live and possibly wrong. Fastest honest recovery is
forward: fix the cause, deploy again. Rolling code back is a `git revert` on `main`
and another deploy. Rolling a migration back is not something this pipeline does,
because migrations here are one-way by design and each one is applied in its own
transaction.

## 12. What is deliberately not here

No Stripe key, no HubSpot token, no Slack token, no SMTP account, no Anthropic key
and no database password is stored in GitHub, in any workflow, in any secret or in
this repository. There is exactly one credential in GitHub: the SSH key from section
2, plus the host key from section 6, which is not secret.

Those application secrets live in `/opt/nothing-gets-lost/.env` on the host and stay
there. `.env` is gitignored, so `git pull --ff-only` cannot touch it, and
`ngl-deploy` never writes to it. `docker compose` reads it directly.

The consequence to accept: rotating a Stripe or Slack token is an edit to
`/opt/nothing-gets-lost/.env` followed by `sudo -u deploy /usr/local/bin/ngl-deploy`
or `docker compose up -d`, done over your own SSH session. That is more manual than
a secret store, and it is the reason a compromise of the GitHub account does not
hand anyone a payment key.
