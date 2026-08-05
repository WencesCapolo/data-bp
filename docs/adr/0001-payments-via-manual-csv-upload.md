---
status: accepted
---

# Pagos enter the mirror by manual CSV upload, not by API

The Platform endpoint that served the Pagos ledger (`/intel/export/payments`) stopped
returning data — it now answers `200` with an empty body regardless of token, and the
Control Panel's own AJAX endpoint that replaces it (`?f=control_subscriptions_get`)
authenticates with a per-session encrypted blob that cannot be replayed from a server.
Every other source (`users`, `teams`, `tournaments`, `content`) still works by token.
So a person downloads the Pagos Export from the Control Panel and uploads it through
a modal on the Sync button; the Upload becomes the row source for the payments step of
the existing Sync, leaving all other steps untouched.

## Consequences

- A complete Sync now requires a human in the loop. The 6-hourly `SyncScheduler` keeps
  refreshing everything except Pagos, so dashboards never go fully stale, but Pagos
  are only as fresh as the last Upload.
- The Upload is the single point where a wrong file can corrupt reported revenue, which
  is why the flow validates and previews before writing anything.
- This is expected to be temporary. Reading Pagos directly from MercadoPago and Stripe
  is the intended replacement for Providers 0 and 4; Manual, Voucher, PayPal and Antel
  have no such path and would still need the Export.
