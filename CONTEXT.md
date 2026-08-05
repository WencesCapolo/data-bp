# Basquetpass Analytics

Analytics over the Basquetpass streaming platform: who subscribes, what they pay,
what they watch, and which matches are broadcast. This app owns no user-facing
product data — it mirrors the platform and reports on it.

## Language

### Sources

**Platform**:
The Basquetpass streaming product itself, where subscribers sign up and watch.
This app is downstream of it and never writes to it.
_Avoid_: the app, production, backend

**Control Panel**:
The Platform's internal admin UI, whose exports are the only way to get some data
out. Its endpoints authenticate per-browser-session, not per-key.
_Avoid_: panel, admin, CMS

**Export**:
A CSV the Control Panel produces for a chosen date range. Two exports matter here
and share identical columns: the **Pagos Export** (a ledger, includes failed
attempts) and the **Suscripciones Export** (a snapshot of currently-active subs).
_Avoid_: report, dump, download

**Upload**:
A Pagos Export handed to this app by a person through the UI, replacing the
Platform endpoint that is no longer reachable.
_Avoid_: import, file, attachment

### Money

**Pago** (payment):
One charge attempt against one Subscriber, successful or not. Identified by the
Platform's own id, and separately by the id the payment provider gave it.
_Avoid_: transaction, charge, order, purchase

**Subscription**:
A Subscriber's ongoing right to watch, established by a successful Pago and
lasting a fixed number of days from it.
_Avoid_: plan, membership, licence

**Provider**:
The external service that took the money — MercadoPago, Stripe, PayPal, Antel —
or the marker for access granted without one (Manual, Voucher).
_Avoid_: platform (ambiguous with Platform), gateway, processor

**Tier**:
Which product a Subscription is for: Mensual Básico, Mensual Total, Anual Total,
or Free. Derived, never stated directly by an Export.
_Avoid_: plan, product, level, sub type

**Period**:
How many days of access one Pago grants — 30, 365, or 0 for access that carries
no recurring right.
_Avoid_: interval, cycle, duration, recurrent

**Access Type**:
Whether a Subscription was paid for in money, granted free, or billed by a
carrier.
_Avoid_: kind, category

### People

**Subscriber**:
A person with a Platform account, identified by the Platform's numeric user id.
Every Pago belongs to exactly one, and a Pago whose Subscriber is unknown to
this app is discarded.
_Avoid_: user, customer, client, account

**Analyst**:
Someone signed in to this app to read dashboards. May also perform an Upload.
_Avoid_: viewer, admin, operator

### Time

**Window**:
The date range an Export covers, decided by whoever downloaded it. An Upload's
Window determines which Pagos it can possibly contain.
_Avoid_: range, period (reserved), timeframe

**Sync**:
One full refresh of this app's mirror of the Platform, ending with every derived
table rebuilt.
_Avoid_: update, refresh, job, run
