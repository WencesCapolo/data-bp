---
status: accepted
---

# Any signed-in Analyst may Upload, and every Upload is recorded

Uploading is a write to reported revenue, which would normally argue for restricting it
to `admin` the way the user allowlist is. We deliberately allow both `admin` and
`viewer`: the team that has the Export to hand is not the team that administers
accounts, and gating it would strand Cobros behind whoever holds the admin role.
The safeguards are provenance and reversibility rather than permission — each Upload
writes a row recording who uploaded what, and the ingest is a pure upsert that adds and
updates but never deletes.

## Consequences

- Authentication is still mandatory. `/api/sync` was reachable unauthenticated (absent
  from the proxy matcher, with `SYNC_TOKEN` empty); admin+viewer means every allowlisted
  signed-in Analyst, not the public.
- A bad Upload is traceable to a person and a filename, but not automatically undone.
  Recovery is re-uploading a correct Export over the same Window.
