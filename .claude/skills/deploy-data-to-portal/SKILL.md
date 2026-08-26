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
| package manager **on the server** | `npm` |
| nginx vhost | `/etc/nginx/sites-available/analytics.conf` |
| public URL | `https://analytics.basket-app.com` |

`npm` on the server, `pnpm` locally. The server's pm2 entry runs `/usr/bin/npm start`,
and `pnpm install` aborts there with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`.
`npm ci` also fails — the checkout has `pnpm-lock.yaml` and no `package-lock.json` — so
installs are plain `npm install`.

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
`sudo npm run views:apply` (~190s, and it drops the five mat views before rebuilding them,
so every tab reading them errors until it finishes), and anything else needs a tsx one-off
— there is **no psql on the box**, and the script has to sit inside `/srv/data-bp` to
resolve `node_modules`. The prod DB is that box's own local Postgres, *not* the `localhost`
in your machine's `.env`: identical connection string, different database.

**3. Pull.** `sudo git pull --ff-only origin main` — sudo, per the prelude, or it
half-applies. Fast-forward only: a merge commit created on the prod box is a state that
exists nowhere else. *Done when:* `sudo git log --oneline -1` shows the sha you expected
from step 2.

**4. Build, and check the exit code.**
`sudo -S -p '' npm run build <<<"$PW" > ~/deploy-build.log 2>&1; echo "BUILD_EXIT=$?"`.
The log goes to your own home: a redirect into a root-owned path fails as your shell,
which prints `BUILD_EXIT=1` while `tail` happily shows the *previous* deploy's route
table — a green-looking build that never ran. *Done when:* `BUILD_EXIT=0` is printed.
Do not judge the build by its output — a failing Next.js build still prints a route
table, which reads as success. If it is non-zero, the old server is still running on
the old `.next`; go to step 7 and report, do not restart.

**5. Restart only `analytics`.** `sudo pm2 restart analytics --update-env`. pm2 runs as
root here, so an unprivileged `pm2` talks to a different, empty daemon. Note the UTC
clock before restarting — step 6 compares a log mtime against it. *Done when:*
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
