// Public types of the Basket.tv telemetry browser SDK (SPEC §11.1).
// Copy this file into an app (e.g. `src/types/bpt.d.ts`) to type `window.bpt`.
// The SDK is loaded with `<script defer src="/_t/sdk.js">`; until it loads (or
// when it is not there at all, e.g. local dev) `window.bpt` may be undefined or
// the queueing stub, so call it with optional chaining: `window.bpt?.track(...)`.

/** Small, non-personal values only: never emails, names or amounts. */
type BptProps = Record<string, string | number | boolean | null>;

interface BptApi {
  /** A business event (SPEC §11.4), e.g. `track('incident_created', { kind: 'audio' })`. */
  track(name: string, props?: BptProps): void;
  /** Report a caught error, e.g. from a React error boundary. Never throws. */
  captureError(err: unknown, extra?: Record<string, unknown>): void;
}

interface Window {
  bpt?: BptApi;
}
