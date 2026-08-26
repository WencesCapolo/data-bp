---
name: deploy-data-to-portal
description: Deploy this repo to the shared basket-app.com box — record a rollback point, pull main, build with npm, restart the analytics pm2 app, smoke it.
disable-model-invocation: true
---

Production is a **shared box**. One VPS carries nine pm2 apps and twelve nginx vhosts:
`portal`, `incidencias`, `clipwave`, `jarvis-bot`, `openwa` and others sit beside this
app. That is the **blast radius** — a reload of the wrong scope, or a `pm2 restart all`,
takes down products unrelated to this one. Every command below is scoped to `analytics`
for that reason, and nothing here restarts, reloads, or rebuilds anything else.

Facts that hold for every deploy:

| | |
|---|---|
| checkout | `/srv/data-bp`, branch `main`, root-owned |
| pm2 app | `analytics` (port 3001) |
| package manager **on the server** | `npm` to run and build, `pnpm` to install — see below |
| nginx vhost | `/etc/nginx/sites-available/analytics.conf` |
| public URL | `https://analytics.basket-app.com` |

`npm` runs the app, **`pnpm` installs it.** The pm2 entry runs `/usr/bin/npm start`, and
`npm run build` is right — but installs are not npm's. That box's `node_modules` is a
pnpm store layout (`node_modules/.pnpm/…`, symlinks, owned by `wences` not root), so
npm's arborist walks into a `Link` node it cannot resolve and dies with

```
npm error Cannot read properties of null (reading 'matches')
```

`npm ci` fails too — `pnpm-lock.yaml`, no `package-lock.json`. The install that works is

```bash
cd /srv/data-bp && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  corepack pnpm@10.20.0 install --frozen-lockfile --config.confirmModulesPurge=false
```

**Unprivileged, not sudo** — the tree and the 1.1 GB store belong to `wences`, and root
would use a different store and reify the whole tree instead of adding what changed.
Pin the version: bare `pnpm` on that box is corepack's latest, which needs Node ≥ 22.13
for `node:sqlite` and the box is on Node 20, so it aborts with `ERR_UNKNOWN_BUILTIN_MODULE`.
`--frozen-lockfile` is what keeps this incremental — it fails rather than drifting, so a
running app never has its tree rebuilt under it.

Skip it entirely when the diff touches no dependency.

## The prelude

Every step runs over ssh, and each shell invocation starts fresh, so each one re-reads
the credentials. That prelude is:

```bash
SERVER=$(grep -m1 '^SERVER=' .env | cut -d= -f2-)
PW=$(grep -m1 '^SERVER_PASS=' .env | cut -d= -f2-)
export SSHPASS="$PW"
sshpass -e ssh -o ConnectTimeout=30 "$SERVER" "..."
```

Two traps it avoids. Do not source `.env` — it is not shell-safe (unquoted parens in the
Google Sheets tab names abort the parse), so read the two keys with `grep`/`cut`. And
sudo on that box demands a password, so every privileged command takes the form
`sudo -S -p '' <cmd> <<<"$PW"`. Never echo `$PW` into output that gets shown back.

**The checkout is root-owned and you ssh in as a normal user, so every git, npm and pm2
command in this skill needs that sudo form** — including the read-only ones, so `git
status` reports the same tree the privileged commands will act on. A bare `git pull`
does not fail cleanly: git writes the files it *can* write as your user, hits the first
root-owned path, and stops with `unable to unlink old '<path>': Permission denied`,
leaving HEAD on the old sha and the tree half-updated. Recovering from that means
`sudo git reset --hard <sha-from-step-1>`, then `sudo git clean -fd -- <the paths git
just created>` (they are listed as `??` by `sudo git status --porcelain`, and they are
all incoming-commit content — but only discard them if step 1 proved the tree clean),
then re-pull as root.

One more shape trap: in `sudo -S -p '' <cmd> <<<"$PW" > file`, the redirect is performed
by *your* shell, not by sudo, so it cannot write anywhere only root can. Redirect to a
path you own (`~/…`), never to a root-owned one like a `/tmp/*.log` a previous deploy
left behind.

Local network calls are sandboxed. `curl` and `ssh` need `dangerouslyDisableSandbox`, or
they fail with a TLS error that looks like a server problem.

## Steps

**1. Record the rollback point.** Read the currently deployed sha before touching
anything: `cd /srv/data-bp && sudo git log --oneline -1 && sudo git status --porcelain`.
*Done when:* you have the sha written down in your reply, and the tree is clean. A dirty
tree means someone edited prod by hand — stop and report it rather than clobbering it.

**2. Gate on migrations.** Diff what is about to land: `sudo git log --oneline HEAD..origin/main`
and check whether it touches `migrations/sql/`. *Done when:* you can state either "no new
migrations" or the exact list of new files. If there are new migrations, **stop and ask**
before continuing. Applying SQL to prod is a separate decision from shipping code, and
this skill does not make it for you. If the answer is yes: `0001_views.sql` goes through
`sudo npm run views:apply` (~160s in prod, and it drops **all six** mat views before
rebuilding them, so every tab reading one errors until it finishes — that is downtime, not
latency, and it belongs in a low-traffic window). Everything else goes through

```bash
sudo -S -p '' node_modules/.bin/tsx --env-file=.env scripts/apply-sql.ts \
  migrations/sql/00NN_*.sql <<<"$PW"
```

There is **no psql on the box**, and the script has to sit inside `/srv/data-bp` to resolve
`node_modules`. `apply-sql.ts` sends one statement per round trip, which is what lets
`CREATE INDEX CONCURRENTLY` run at all — a whole-file execute wraps the file in an implicit
transaction and CONCURRENTLY cannot live in one. It prints the database it actually reached
before it writes anything, and you should read that line: the prod DB is that box's own
local Postgres, *not* the `localhost` in your machine's `.env`. Identical connection string,
different database. `scripts/_q.ts "<sql>"` is the read-only companion.

Order the two: additive migrations first, then `views:apply` **after** the build, so the
build's five-to-ten minutes do not sit inside the downtime window.

**3. Pull.** `sudo git pull --ff-only origin main` — sudo, per the prelude, or it
half-applies. Fast-forward only: a merge commit created on the prod box is a state that
exists nowhere else. *Done when:* `sudo git log --oneline -1` shows the sha you expected
from step 2.

**4. Install if dependencies changed, then build and check the exit code.** Diff
`package.json` first; if a dependency moved, run the pnpm install from **The prelude**
above — *not* `npm install`, which cannot read this box's tree. Then
`sudo -S -p '' npm run build <<<"$PW" > ~/deploy-build.log 2>&1; echo "BUILD_EXIT=$?"`.
The log goes to your own home: a redirect into a root-owned path fails as your shell,
which prints `BUILD_EXIT=1` while `tail` happily shows the *previous* deploy's route
table — a green-looking build that never ran. *Done when:* `BUILD_EXIT=0` is printed.
Do not judge the build by its output — a failing Next.js build still prints a route
table, which reads as success. If it is non-zero, the old server is still running on
the old `.next`; go to step 7 and report, do not restart.

**5. Restart only `analytics`.** `sudo pm2 restart analytics --update-env`. pm2 runs as
root here, so an unprivileged `pm2` talks to a different, empty daemon. Note the UTC
clock before restarting — step 6 compares a log mtime against it.

`--update-env` reads the **calling shell's** environment, not `/srv/data-bp/.env`. A
variable you appended to that file will not appear in `sudo pm2 env <id>` no matter how
many times you restart with the flag. Next does load `.env` for the app itself, so the
process usually still sees it — but if the done-when is "pm2 shows it", pass it through:

```bash
sudo -S -p '' env MY_VAR=value pm2 restart analytics --update-env <<<"$PW"
``` *Done when:*
`sudo pm2 list` shows `analytics` `online`, and `sudo pm2 logs analytics --lines 6
--nostream` ends in `✓ Ready`.

**6. Smoke it.** Four checks, all of them, from your machine:

| check | expected |
|---|---|
| `GET https://analytics.basket-app.com/` | `307` — the SSO bounce to portal. Not `200`: unauthenticated is *supposed* to redirect |
| `POST /api/basket/payments/upload` with a >5 MB file | `401` — auth rejects it, meaning nginx passed the body. A `413` means the body cap regressed |
| `GET https://portal.basket-app.com/` and `https://incidencias.basket-app.com/` | `307` each — proof the blast radius stayed contained |
| `sudo stat -c %y /root/.pm2/logs/analytics-error.log` (over ssh) | mtime **older** than the restart |

*Done when:* all four match. On the log check, `Failed to find Server Action "x"` entries
are ordinary post-deploy noise — browsers holding stale bundles — so compare the file's
mtime against your restart time instead of reading the lines. Only entries written *after*
the restart are yours.

**7. Report what you verified.** Name the sha deployed, the sha you can roll back to, and
each smoke check with its actual status code. *Done when:* every check in step 6 is
reported with its real result, including any that failed. A deploy reported as clean when
a check was skipped is worse than a deploy reported as broken.

## Rollback

Reset to the sha from step 1, rebuild, restart:

```bash
sudo git reset --hard <sha-from-step-1> && sudo npm run build && sudo pm2 restart analytics
```

This is the one destructive command in the skill, and it is why step 1 comes first. If
you skipped step 1, recover the sha from `git reflog` before running it.

Then re-run step 6 — a rollback is a deploy and gets smoked like one.

For symptoms rather than steps — 413s, 502s, expired sync cookies, nginx body limits —
read [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
