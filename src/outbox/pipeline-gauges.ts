import { Injectable } from '@nestjs/common';
import { Gauge, Registry } from 'prom-client';
import { DataSource } from 'typeorm';
import { rows } from '../db/sql.js';

/**
 * The two database signals of the receipt path (docs/observability, 2.2), read at scrape
 * time. The symptom is the age of the oldest deal of the last 24 h without a receipt (the
 * page fires on it); the outbox age is the first place to look (is the relay stuck?).
 * 0 means "nothing is waiting". If the query fails the whole scrape fails (500), so
 * Prometheus sees `up == 0` for the relay instead of a stale or zero age: a relay that
 * cannot read the database moves no receipts either.
 *
 * In the relay process: it has the database and runs whenever receipts can flow at all.
 * Several relays report the same value; the alert takes the max.
 */
@Injectable()
export class PipelineGauges {
  constructor(dataSource: DataSource, registry: Registry) {
    dbGauge(
      registry,
      dataSource,
      'outbox_oldest_unpublished_seconds',
      'Age of the oldest outbox row not yet handed to the queue',
      // The partial index on unpublished rows keeps this small.
      `SELECT coalesce(extract(epoch FROM now() - min(created_at)), 0)::float8 AS seconds
         FROM outbox WHERE published_at IS NULL`,
    );
    dbGauge(
      registry,
      dataSource,
      'receipt_oldest_missing_seconds',
      'Age of the oldest deal of the last 24 h whose receipt has not been sent',
      `SELECT coalesce(extract(epoch FROM now() - min(d.created_at)), 0)::float8 AS seconds
         FROM deals d
        WHERE d.created_at > now() - interval '24 hours'
          AND NOT EXISTS (SELECT 1 FROM deal_receipts r WHERE r.deal_id = d.id)`,
    );
  }
}

function dbGauge(
  registry: Registry,
  dataSource: DataSource,
  name: string,
  help: string,
  sql: string,
) {
  new Gauge({
    name,
    help,
    registers: [registry],
    async collect() {
      const [row] = await rows<{ seconds: number }>(dataSource.manager, sql);
      this.set(row.seconds);
    },
  });
}
