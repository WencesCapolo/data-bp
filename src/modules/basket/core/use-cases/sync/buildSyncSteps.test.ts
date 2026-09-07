import { describe, expect, it } from 'vitest';
import { buildSyncSteps, type SyncSources } from './buildSyncSteps';
import { STEP } from './syncSteps';
import { RunSyncUseCase } from './RunSyncUseCase';

// Nothing here is ever executed: the list is built and inspected. Every
// dependency is a placeholder cast to its port.
const stub = <T>(): T => ({}) as T;
async function* noRows(): AsyncGenerator<never> {}

function everySource(): SyncSources {
  return {
    fetcher: stub(),
    syncState: stub(),
    matViews: stub(),
    tournaments: { repo: stub(), resource: 'tournaments', mapRow: () => null },
    teams: { repo: stub(), resource: 'teams', mapRow: () => null },
    users: { repo: stub(), resource: 'users', mapRow: () => null },
    payments: { repo: stub(), source: { kind: 'upload', rows: noRows(), mapRow: () => null } },
    content: { repo: stub(), resource: 'content', windowDays: 30, mapRow: () => null },
    sheets: {
      fetcher: stub(),
      rows: { repo: stub(), specs: [] },
      fixtures: { repo: stub(), specs: [], mapRow: () => null },
      dataMasters: { repo: stub(), specs: [] },
    },
    gateways: {
      fees: { useCase: stub(), overlapDays: 14, windowDays: 7 },
      subscriptions: stub(),
      customers: stub(),
      disputes: stub(),
      payouts: stub(),
      mirrorWindow: { overlapDays: 30, windowDays: 30 },
    },
    fxRates: stub(),
    exportInbox: stub(),
  };
}

const names = (s: SyncSources, scope?: 'full' | 'upload') => buildSyncSteps(s, scope).map((x) => x.name);
const before = (list: string[], a: string, b: string) => list.indexOf(a) < list.indexOf(b);

describe('the full list', () => {
  it('holds every step, in the order ADR 0006 numbers them', () => {
    const list = names(everySource());
    expect(list).toEqual([
      STEP.tournaments, STEP.teams, STEP.users, STEP.payments, STEP.content,
      STEP.sheets, STEP.fixtures, STEP.dataMasters,
      STEP.fees, STEP.subscriptions, STEP.customers, STEP.disputes, STEP.payouts,
      STEP.fxRates, STEP.exportInbox,
      STEP.reconcile, STEP.refresh,
    ]);
  });

  it('runs fees before FX, fees and the inbox before reconciliation, and the refresh last', () => {
    const list = names(everySource());
    expect(before(list, STEP.fees, STEP.fxRates)).toBe(true);
    expect(before(list, STEP.fees, STEP.reconcile)).toBe(true);
    expect(before(list, STEP.exportInbox, STEP.reconcile)).toBe(true);
    expect(list.at(-1)).toBe(STEP.refresh);
  });

  it('declares those invariants on the steps, so the runner checks them', () => {
    const steps = buildSyncSteps(everySource());
    const after = (name: string) => steps.find((s) => s.name === name)?.after ?? [];
    expect(after(STEP.fxRates)).toContain(STEP.fees);
    expect(after(STEP.reconcile)).toEqual(expect.arrayContaining([STEP.fees, STEP.exportInbox]));
    expect(after(STEP.refresh)).toContain(STEP.reconcile);
    expect(() => new RunSyncUseCase(steps)).not.toThrow();
  });

  it('declares the policy each step has always had', () => {
    const policy = Object.fromEntries(buildSyncSteps(everySource()).map((s) => [s.name, s.policy]));
    expect(policy).toEqual({
      [STEP.tournaments]: 'fatal',
      [STEP.teams]: 'fatal',
      [STEP.users]: 'fatal',
      [STEP.payments]: 'fatal',
      [STEP.content]: 'fatal',
      [STEP.sheets]: 'per-item',
      [STEP.fixtures]: 'per-item',
      [STEP.dataMasters]: 'per-item',
      [STEP.fees]: 'never-fatal',
      [STEP.subscriptions]: 'never-fatal',
      [STEP.customers]: 'never-fatal',
      [STEP.disputes]: 'never-fatal',
      [STEP.payouts]: 'never-fatal',
      [STEP.fxRates]: 'never-fatal',
      [STEP.exportInbox]: 'never-fatal',
      [STEP.reconcile]: 'never-fatal',
      [STEP.refresh]: 'fatal',
    });
  });

  it('drops the steps whose sources are absent and still accepts the order', () => {
    const s = everySource();
    delete s.content;
    delete s.sheets;
    delete s.gateways;
    delete s.fxRates;
    delete s.exportInbox;
    s.payments.source = null;
    const steps = buildSyncSteps(s);
    expect(steps.map((x) => x.name)).toEqual([STEP.tournaments, STEP.teams, STEP.users, STEP.reconcile, STEP.refresh]);
    expect(() => new RunSyncUseCase(steps)).not.toThrow();
  });
});

describe('the upload list', () => {
  it('is exactly payments → reconcile → refresh', () => {
    expect(names(everySource(), 'upload')).toEqual([STEP.payments, STEP.reconcile, STEP.refresh]);
  });

  it('refuses to run without a Pagos Export', () => {
    const s = everySource();
    s.payments.source = null;
    expect(() => buildSyncSteps(s, 'upload')).toThrow("scope 'upload'");
    s.payments.source = { kind: 'live', fetcher: stub(), resource: 'payments', window: '-1month', mapRow: () => null };
    expect(() => buildSyncSteps(s, 'upload')).toThrow("scope 'upload'");
  });
});
