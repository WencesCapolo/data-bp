/**
 * The two questions an Upload preview asks the mirror before anything is
 * written. Both are advisory: an answer of `null` means "could not ask" and the
 * preview stays silent on that point rather than claiming every row would be
 * skipped. That is why these are not on the entity repositories — they tolerate
 * a missing table, which an upsert never should.
 */
export interface IPagosUploadLookups {
  /** Which of these Subscriber ids the mirror knows. */
  knownSubscriberIds(ids: number[]): Promise<Set<number> | null>;
  /** Lower-cased currencies with at least one monthly Tier in the price book (ADR 0003). */
  monthlyTierCurrencies(): Promise<Set<string> | null>;
}

export interface IFeeUploadLookups {
  /** Which of these Provider ids already have a Pago, for one Provider. */
  existingPagoIds(ids: string[], platform: number): Promise<Set<string> | null>;
  /** Which of these Provider ids already carry a fee row, for one Provider. */
  existingFeeIds(ids: string[], platform: number): Promise<Set<string> | null>;
}
