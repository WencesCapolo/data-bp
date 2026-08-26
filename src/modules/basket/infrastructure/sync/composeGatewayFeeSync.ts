import { DrizzleGatewayFeeRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewayFeeRepository';
import { DrizzleSyncStateRepository } from '@basket/infrastructure/db/repositories/DrizzleSyncStateRepository';
import { StripeFeeFetcher } from '@basket/infrastructure/gateways/StripeFeeFetcher';
import { StripeSubscriptionFetcher } from '@basket/infrastructure/gateways/StripeSubscriptionFetcher';
import { DrizzleGatewaySubscriptionRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewaySubscriptionRepository';
import type { IGatewaySubscriptionFetcher } from '@basket/core/ports/IGatewaySubscriptionFetcher';
import { SyncGatewaySubscriptionsUseCase } from '@basket/core/use-cases/sync/SyncGatewaySubscriptionsUseCase';
import { MercadoPagoFeeFetcher } from '@basket/infrastructure/gateways/MercadoPagoFeeFetcher';
import type { IGatewayFeeFetcher } from '@basket/core/ports/IGatewayFeeFetcher';
import { SyncGatewayFeesUseCase } from '@basket/core/use-cases/sync/SyncGatewayFeesUseCase';
import { StripeCustomerFetcher } from '@basket/infrastructure/gateways/StripeCustomerFetcher';
import { StripeDisputeFetcher } from '@basket/infrastructure/gateways/StripeDisputeFetcher';
import { StripePayoutFetcher } from '@basket/infrastructure/gateways/StripePayoutFetcher';
import { DrizzleGatewayCustomerRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewayCustomerRepository';
import { DrizzleGatewayDisputeRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewayDisputeRepository';
import { DrizzleGatewayPayoutRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewayPayoutRepository';
import type { GatewayCustomerProps } from '@basket/core/entities/GatewayCustomer';
import type { GatewayDisputeProps } from '@basket/core/entities/GatewayDispute';
import type { GatewayPayoutProps } from '@basket/core/entities/GatewayPayout';
import type { GatewayFullSource, GatewayWindowSource } from '@basket/core/ports/IGatewayMirror';
import {
  SyncGatewayFullMirrorUseCase,
  SyncGatewayWindowMirrorUseCase,
} from '@basket/core/use-cases/sync/SyncGatewayMirrorUseCase';
import { SyncFxRatesUseCase } from '@basket/core/use-cases/sync/SyncFxRatesUseCase';
import { ArgentinaDatosEurUsdFetcher } from '@basket/infrastructure/fx/ArgentinaDatosEurUsdFetcher';
import { DolarApiBlueFetcher } from '@basket/infrastructure/fx/DolarApiBlueFetcher';
import { DrizzleFxRateRepository } from '@basket/infrastructure/db/repositories/DrizzleFxRateRepository';

export interface ComposeGatewayFeeSyncOptions {
  /** Restrict to specific gateways by slug. Omitted, every configured one runs. */
  only?: string[];
}

export interface ComposedGatewayFeeSync {
  useCase: SyncGatewayFeesUseCase;
  /** Null when no gateway exposes subscriptions — MercadoPago preapprovals are
   *  not modelled here yet, so today this is Stripe or nothing. */
  subscriptionsUseCase: SyncGatewaySubscriptionsUseCase | null;
  /** Customer mirror — the customer_id -> email bridge. Full refresh. Stripe
   *  only today; MercadoPago's clientes Export arrives through the Upload. */
  customersUseCase: SyncGatewayFullMirrorUseCase<GatewayCustomerProps> | null;
  /** Chargebacks. Windowed on the dispute's creation, with a long overlap. */
  disputesUseCase: SyncGatewayWindowMirrorUseCase<GatewayDisputeProps> | null;
  /** Money leaving the Provider for the bank. Windowed on creation. */
  payoutsUseCase: SyncGatewayWindowMirrorUseCase<GatewayPayoutProps> | null;
  /** Slugs that ended up wired, so callers can report an empty run honestly. */
  slugs: string[];
  /** Gateways skipped for want of a credential, and which env var was missing. */
  skipped: { slug: string; missing: string }[];
}

/**
 * Wires whichever gateways have credentials.
 *
 * A missing credential is a skip, not a throw: the two gateways are onboarded
 * independently, and Stripe fees should not be blocked for weeks because the
 * MercadoPago token has not been issued yet. The skip is returned rather than
 * swallowed, so the caller can print it and nobody mistakes a half-configured
 * run for a complete one.
 */
export function composeGatewayFeeSync(
  options: ComposeGatewayFeeSyncOptions = {},
): ComposedGatewayFeeSync {
  const wanted = options.only?.length ? new Set(options.only) : null;
  const fetchers: IGatewayFeeFetcher[] = [];
  const subFetchers: IGatewaySubscriptionFetcher[] = [];
  const customerFetchers: GatewayFullSource<GatewayCustomerProps>[] = [];
  const disputeFetchers: GatewayWindowSource<GatewayDisputeProps>[] = [];
  const payoutFetchers: GatewayWindowSource<GatewayPayoutProps>[] = [];
  const skipped: { slug: string; missing: string }[] = [];

  const logRetry = (slug: string) => (info: {
    attempt: number;
    status: number | null;
    waitMs: number;
    reason: string;
  }) => {
    console.warn(
      `[${slug}] retry ${info.attempt} after ${info.waitMs}ms ` +
        `(status=${info.status ?? 'transport'}): ${info.reason.slice(0, 120)}`,
    );
  };

  if (!wanted || wanted.has('stripe')) {
    // Two names because the deployed environment holds the restricted key under
    // STRIPE_SERVICE_KEY while every script and doc here says STRIPE_SECRET_KEY.
    // Accepting both is cheaper than a rename that silently unwires the sync on
    // whichever host is updated second.
    const key = process.env.STRIPE_SECRET_KEY ?? process.env.STRIPE_SERVICE_KEY;
    const stripe = {
      apiVersion: process.env.STRIPE_API_VERSION,
      onRetry: logRetry('stripe'),
    };
    if (key) {
      fetchers.push(new StripeFeeFetcher({ secretKey: key, ...stripe }));
      subFetchers.push(new StripeSubscriptionFetcher({ secretKey: key, ...stripe }));
      customerFetchers.push(new StripeCustomerFetcher({ secretKey: key, ...stripe }));
      disputeFetchers.push(new StripeDisputeFetcher({ secretKey: key, ...stripe }));
      payoutFetchers.push(new StripePayoutFetcher({ secretKey: key, ...stripe }));
    } else {
      skipped.push({ slug: 'stripe', missing: 'STRIPE_SECRET_KEY' });
    }
  }

  if (!wanted || wanted.has('mercadopago')) {
    const token = process.env.MP_ACCESS_TOKEN;
    if (token) {
      fetchers.push(new MercadoPagoFeeFetcher({
        accessToken: token,
        onRetry: logRetry('mercadopago'),
        onWindowOverflow: (window, total) => {
          console.error(
            `[mercadopago] ${total} payments inside ${window.from.toISOString()}` +
              `→${window.to.toISOString()}; MercadoPago cannot return past 1000 ` +
              `and the window cannot be split further — rows were LOST`,
          );
        },
      }));
    } else {
      skipped.push({ slug: 'mercadopago', missing: 'MP_ACCESS_TOKEN' });
    }
  }

  const syncState = () => new DrizzleSyncStateRepository();

  return {
    useCase: new SyncGatewayFeesUseCase(
      fetchers,
      new DrizzleGatewayFeeRepository(),
      syncState(),
    ),
    subscriptionsUseCase: subFetchers.length
      ? new SyncGatewaySubscriptionsUseCase(
          subFetchers,
          new DrizzleGatewaySubscriptionRepository(),
          syncState(),
        )
      : null,
    customersUseCase: customerFetchers.length
      ? new SyncGatewayFullMirrorUseCase(
          'customers',
          customerFetchers,
          new DrizzleGatewayCustomerRepository(),
          syncState(),
        )
      : null,
    disputesUseCase: disputeFetchers.length
      ? new SyncGatewayWindowMirrorUseCase(
          'disputes',
          disputeFetchers,
          new DrizzleGatewayDisputeRepository(),
          syncState(),
        )
      : null,
    payoutsUseCase: payoutFetchers.length
      ? new SyncGatewayWindowMirrorUseCase(
          'payouts',
          payoutFetchers,
          new DrizzleGatewayPayoutRepository(),
          syncState(),
        )
      : null,
    slugs: fetchers.map((f) => f.slug),
    skipped,
  };
}


/**
 * Wires the FX rate sync.
 *
 * Takes no credential and therefore has no skip: dolarapi is public, and the
 * derived Stripe rows are read out of a table this repo already owns. It lives
 * beside the gateway composition rather than in it because a rate is not a
 * Provider object — nothing here has a `platform` — and folding it into
 * `composeGatewayFeeSync` would have meant the blue rate stops being fetched
 * whenever a Stripe key expires.
 */
export function composeFxRateSync(): SyncFxRatesUseCase {
  return new SyncFxRatesUseCase(
    [
      new DolarApiBlueFetcher({
        onRetry: (info) => {
          console.warn(
            `[fx:blue] retry ${info.attempt} after ${info.waitMs}ms ` +
              `(status=${info.status ?? 'transport'}): ${info.reason.slice(0, 120)}`,
          );
        },
      }),
      // EUR→USD crossed through ARS off the same host. Not a fallback for the
      // blue: a different pair, a different source, its own rows.
      new ArgentinaDatosEurUsdFetcher({
        onRetry: (info) => {
          console.warn(
            `[fx:eur] retry ${info.attempt} after ${info.waitMs}ms ` +
              `(status=${info.status ?? 'transport'}): ${info.reason.slice(0, 120)}`,
          );
        },
      }),
    ],
    new DrizzleFxRateRepository(),
    new DrizzleSyncStateRepository(),
  );
}
