import type { EntityManager } from 'typeorm';
import { rows } from '../db/sql.js';

export interface DailyReport {
  /** The report covers the 24 hours before this moment. */
  periodEnd: Date;
  publishedNow: number;
  publishedLastDay: number;
  dealsLastDay: number;
  /** Cents, as text: a sum of bigints does not fit a JS number in general. */
  dealsAmountLastDay: string;
}

export async function buildDailyReport(
  em: EntityManager,
  periodEnd: Date,
): Promise<DailyReport> {
  const [counts] = await rows<{
    published_now: number;
    published_last_day: number;
    deals: number;
    amount: string;
  }>(
    em,
    `SELECT (SELECT count(*) FROM lots WHERE is_published)::int AS published_now,
            (SELECT count(DISTINCT lot_id) FROM lot_publication_history
              WHERE is_published
                AND changed_at > $1::timestamptz - interval '1 day'
                AND changed_at <= $1::timestamptz)::int AS published_last_day,
            (SELECT count(*) FROM deals
              WHERE created_at > $1::timestamptz - interval '1 day'
                AND created_at <= $1::timestamptz)::int AS deals,
            (SELECT coalesce(sum(quantity::bigint * unit_price), 0) FROM deals
              WHERE created_at > $1::timestamptz - interval '1 day'
                AND created_at <= $1::timestamptz)::text AS amount`,
    [periodEnd],
  );
  return {
    periodEnd,
    publishedNow: counts.published_now,
    publishedLastDay: counts.published_last_day,
    dealsLastDay: counts.deals,
    dealsAmountLastDay: counts.amount,
  };
}
