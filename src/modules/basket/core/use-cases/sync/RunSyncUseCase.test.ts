import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunSyncUseCase } from './RunSyncUseCase';
import { emptyContribution, foldContribution, type PerItemStep, type SyncStep } from './SyncStep';

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});
afterEach(() => vi.restoreAllMocks());

function counting(name: string, policy: 'fatal' | 'never-fatal', ran: string[], fail = false): SyncStep {
  return {
    name,
    policy,
    async run() {
      ran.push(name);
      if (fail) throw new Error(`${name} broke`);
      return { syncedUsers: 1 };
    },
  };
}

function perItem(name: string, items: string[], bad: string, ran: string[]): PerItemStep<string> {
  return {
    name,
    policy: 'per-item',
    items,
    itemName: (i) => i,
    async runItem(item) {
      ran.push(`${name}:${item}`);
      if (item === bad) throw new Error(`${item} broke`);
      return { syncedSheets: [{ sheet: item, inserted: 3 }] };
    },
    failedItem: (item) => ({ syncedSheets: [{ sheet: item, inserted: -1 }] }),
  };
}

describe('RunSyncUseCase policies', () => {
  it('a fatal step that throws aborts the run and the error propagates unchanged', async () => {
    quiet();
    const ran: string[] = [];
    const sync = new RunSyncUseCase([
      counting('a', 'fatal', ran),
      counting('b', 'fatal', ran, true),
      counting('c', 'fatal', ran),
    ]);
    await expect(sync.execute()).rejects.toThrow('b broke');
    expect(ran).toEqual(['a', 'b']);
  });

  it('a never-fatal step that throws is recorded and the run continues', async () => {
    quiet();
    const ran: string[] = [];
    const sync = new RunSyncUseCase([
      counting('a', 'fatal', ran),
      counting('b', 'never-fatal', ran, true),
      counting('c', 'fatal', ran),
    ]);
    const r = await sync.execute();
    expect(ran).toEqual(['a', 'b', 'c']);
    expect(r.failedSteps).toEqual([{ step: 'b', error: 'b broke' }]);
    expect(r.syncedUsers).toBe(2);
  });

  it('under per-item one bad item costs that item only, and records its own marker', async () => {
    quiet();
    const ran: string[] = [];
    const sync = new RunSyncUseCase([perItem('sheets', ['x', 'y', 'z'], 'y', ran), counting('after', 'fatal', ran)]);
    const r = await sync.execute();
    expect(ran).toEqual(['sheets:x', 'sheets:y', 'sheets:z', 'after']);
    expect(r.syncedSheets).toEqual([
      { sheet: 'x', inserted: 3 },
      { sheet: 'y', inserted: -1 },
      { sheet: 'z', inserted: 3 },
    ]);
    expect(r.failedSteps).toEqual([{ step: 'sheets', item: 'y', error: 'y broke' }]);
  });

  it('every step of one run sees the same runAt', async () => {
    const seen: Date[] = [];
    const step = (name: string): SyncStep => ({
      name,
      policy: 'fatal',
      async run({ runAt }) {
        seen.push(runAt);
        return {};
      },
    });
    await new RunSyncUseCase([step('a'), step('b')]).execute();
    expect(seen[0]).toBe(seen[1]);
  });

  it('refuses a list whose declared order is violated, and accepts one whose after names an absent step', () => {
    const a: SyncStep = { name: 'a', policy: 'fatal', after: ['b'], run: async () => ({}) };
    const b: SyncStep = { name: 'b', policy: 'fatal', run: async () => ({}) };
    expect(() => new RunSyncUseCase([a, b])).toThrow("'a' must run after 'b'");
    expect(() => new RunSyncUseCase([b, a])).not.toThrow();
    expect(() => new RunSyncUseCase([a])).not.toThrow();
    expect(() => new RunSyncUseCase([b, b])).toThrow('listed twice');
  });
});

describe('foldContribution', () => {
  it('adds numbers, concatenates arrays, replaces the rest', () => {
    const one = foldContribution(emptyContribution(), {
      syncedPayments: 2,
      gatewayFees: [{ slug: 'stripe' } as never],
      exportInbox: { files: [], error: null } as never,
    });
    const two = foldContribution(one, { syncedPayments: 3, gatewayFees: [{ slug: 'mp' } as never] });
    expect(two.syncedPayments).toBe(5);
    expect(two.gatewayFees.map((f) => f.slug)).toEqual(['stripe', 'mp']);
    expect(two.exportInbox).toEqual({ files: [], error: null });
    expect(two.syncedUsers).toBe(0);
  });
});
