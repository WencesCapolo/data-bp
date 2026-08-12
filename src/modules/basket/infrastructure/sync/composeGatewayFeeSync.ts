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

export interface ComposeGatewayFeeSyncOptions {
  /** Restrict to specific gateways by slug. Omitted, every configured one runs. */
  only?: string[];
}

export interface ComposedGatewayFeeSync {
  useCase: SyncGatewayFeesUseCase;
  /** Null when no gateway exposes subscriptions — MercadoPago preapprovals are
   *  not modelled here yet, so today this is Stripe or nothing. */
  subscriptionsUseCase: SyncGatewaySubscriptionsUseCase | null;
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
    const key = process.env.STRIPE_SECRET_KEY;
    if (key) {
      fetchers.push(new StripeFeeFetcher({
        secretKey: key,
        apiVersion: process.env.STRIPE_API_VERSION,
        onRetry: logRetry('stripe'),
      }));
      subFetchers.push(new StripeSubscriptionFetcher({
        secretKey: key,
        apiVersion: process.env.STRIPE_API_VERSION,
        onRetry: logRetry('stripe'),
      }));
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

  return {
    useCase: new SyncGatewayFeesUseCase(
      fetchers,
      new DrizzleGatewayFeeRepository(),
      new DrizzleSyncStateRepository(),
    ),
    subscriptionsUseCase: subFetchers.length
      ? new SyncGatewaySubscriptionsUseCase(
          subFetchers,
          new DrizzleGatewaySubscriptionRepository(),
          new DrizzleSyncStateRepository(),
        )
      : null,
    slugs: fetchers.map((f) => f.slug),
    skipped,
  };
}
