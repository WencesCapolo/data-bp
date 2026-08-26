# Troubleshooting a deploy

Symptoms, and where each one actually comes from. Read the entry, not the whole file.

## Upload fails with 413

nginx, not the app. The endpoint caps uploads at `MAX_UPLOAD_BYTES` and answers `400`
with a JSON rejection, so it can never emit a `413`; Next.js 16 emits one only on the
PPR-resume path, which this app does not use. A `413` therefore always means a proxy
capped the body before the request reached Next.js.

nginx defaults `client_max_body_size` to **1 MB** and answers the 413 itself, with an
HTML body — which is why it surfaces in the UI as a parse failure rather than a size
error. The analytics vhost carries `client_max_body_size 64m;` to match the app. Check it
survived:

```bash
grep -n client_max_body_size /etc/nginx/sites-available/analytics.conf
```

If it is missing, add it inside the `server` block, then `nginx -t` **before**
`systemctl reload nginx`. Never reload on an untested config: that reload is
box-wide, so a syntax error takes all twelve vhosts with it.

`nginx -t` prints two pre-existing warnings about a conflicting
`incidencias.basket-app.com` server name. They are unrelated duplicate vhost files. A
successful test still ends in `syntax is ok` / `test is successful`.

## Site returns 502

The pm2 app is down or was never listening. nginx proxies to `127.0.0.1:3001`, so a 502
is nginx reporting that nothing answered.

```bash
pm2 list | grep analytics
ss -ltnp | grep 3001
pm2 logs analytics --lines 40 --nostream
```

Common cause: a restart on a failed build. Check `/tmp/build.log` for the last build's
real outcome.

## Build succeeded but the change is not live

Either the restart did not happen, or it restarted a different app. Confirm the running
process picked up the new build:

```bash
cat /srv/data-bp/.next/BUILD_ID
pm2 describe analytics | grep -iE "uptime|restart"
```

An `analytics` uptime older than the build's timestamp means the restart never landed.

## `pnpm install` aborts with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY

You used pnpm on the server. The box runs npm. Use `npm install`, and note that
`npm ci` fails there too — the checkout has no `package-lock.json`.

This one is quiet and dangerous: the aborted install returns non-zero but the *build*
that follows still succeeds against the stale `node_modules`. A deploy that adds a
dependency will therefore build green and fail at runtime. If the diff touches
`package.json`, confirm the install ran before trusting the build.

## Sync fails with "Expiró la Cookie"

Not a deploy problem, and a restart will not fix it. The scheduled sync authenticates to
the Control Panel with a cookie that expires; when it does, `/payments` answers with no
CSV rows and the scheduler logs `Expiró la Cookie: /payments respondió sin filas CSV`.
The manual Pagos Export upload exists to cover exactly this window.

## Errors in the log right after a restart

`Failed to find Server Action "x"` is expected churn: browsers still holding the previous
deploy's bundle post to action ids the new build does not have. It clears as clients
reload.

Judge the log by mtime against your restart, not by content. Entries older than the
restart are someone else's problem.
